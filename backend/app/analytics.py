"""Owner-only descriptive analytics; no model calls, diagnosis or worker scoring."""
from fastapi import APIRouter,HTTPException,Query
from app.history import history_cursor
from app.identity import principal

router=APIRouter(prefix='/api',tags=['Owner maintenance analytics'])
FACTS=r'''
WITH latest_fact AS (
 SELECT DISTINCT ON (a.report_id) a.report_id,r.id AS review_id,r.facts,
 p.created_at AS reported_at,p.created_by_account_id,
 CASE WHEN link.id IS NOT NULL THEN link.machine_id ELSE r.machine_id END AS machine_id
 FROM sentinel.extraction_reviews r
 JOIN sentinel.report_extractions x ON x.id=r.extraction_id AND x.organization_id=r.organization_id
 JOIN sentinel.transcription_attempts a ON a.id=x.attempt_id AND a.organization_id=x.organization_id
 JOIN sentinel.reports p ON p.id=a.report_id AND p.organization_id=a.organization_id
 LEFT JOIN LATERAL (
   SELECT e.id,e.machine_id FROM sentinel.machine_link_events e
   WHERE e.review_id=r.id AND e.organization_id=r.organization_id ORDER BY e.sequence_number DESC LIMIT 1
 ) link ON true
 WHERE r.organization_id=%s
 AND (%s::integer=0 OR (p.created_at>=current_timestamp-(%s::integer*interval '1 day') AND p.created_at<=current_timestamp))
 ORDER BY a.report_id,a.attempt_number DESC,r.created_at DESC,r.id DESC
), facts AS (
 SELECT f.*,m.code AS machine_code,m.name AS machine_name,m.department,
 lower(btrim(regexp_replace(coalesce(f.facts->>'reported_issue',''), '\s+', ' ', 'g'))) AS issue_key,
 work.id AS work_id,work.status AS work_status,work.outcome AS work_outcome,
 work.machine_id AS work_machine_id,work.created_at AS work_updated_at,
 work.technician_id,t.name AS technician_name,
 submitter.username AS submitter_username,submitter.display_name AS submitter_name
 FROM latest_fact f
 LEFT JOIN sentinel.machines m ON m.id=f.machine_id AND m.organization_id=%s
 LEFT JOIN LATERAL (
   SELECT e.id,e.status,e.outcome,e.machine_id,e.created_at,e.technician_id
   FROM sentinel.repair_events e WHERE e.review_id=f.review_id AND e.organization_id=%s
   ORDER BY e.sequence_number DESC LIMIT 1
 ) work ON true
 LEFT JOIN sentinel.technicians t ON t.id=work.technician_id AND t.organization_id=%s
 LEFT JOIN sentinel.accounts submitter ON submitter.id=f.created_by_account_id AND submitter.organization_id=%s
)
'''
REPEATS='''SELECT machine_id,machine_name,machine_code,department,issue_key AS reported_issue,
 count(*) AS report_count,max(reported_at) AS last_reported_at,
 min(facts->>'reported_issue') AS issue_example
 FROM facts WHERE machine_id IS NOT NULL AND issue_key<>''
 GROUP BY machine_id,machine_name,machine_code,department,issue_key HAVING count(*)>=2'''

@router.get('/analytics')
def analytics(days:int=Query(0,ge=0),issue_offset:int=Query(0,ge=0)):
    if principal().role!='owner':raise HTTPException(403,'Only the factory owner can view maintenance analytics.')
    if days not in (0,7,30,90):raise HTTPException(422,'Choose all time, 7, 30 or 90 days.')
    with history_cursor() as (cur,org):
        params=(org,days,days,org,org,org,org)
        cur.execute('''SELECT count(*) AS total_reports FROM sentinel.reports p WHERE organization_id=%s
          AND (%s::integer=0 OR (p.created_at>=current_timestamp-(%s::integer*interval '1 day') AND p.created_at<=current_timestamp))''',(org,days,days))
        total=cur.fetchone()['total_reports']
        cur.execute(FACTS+'''SELECT count(*) AS reviewed_reports,
          count(*) FILTER(WHERE machine_id IS NOT NULL) AS linked_reports,
          count(*) FILTER(WHERE machine_id IS NULL) AS unlinked_reports,
          count(*) FILTER(WHERE work_id IS NULL) AS no_recorded_work,
          count(*) FILTER(WHERE work_status='assigned') AS assigned_work,
          count(*) FILTER(WHERE work_status='in_progress') AS in_progress_work,
          count(*) FILTER(WHERE work_status='completed') AS completed_work,
          count(*) FILTER(WHERE work_id IS NOT NULL AND work_machine_id IS DISTINCT FROM machine_id) AS work_machine_mismatches
          FROM facts''',params)
        counts=dict(cur.fetchone());counts['total_reports']=total;counts['without_reviewed_facts']=total-counts['reviewed_reports']
        cur.execute(FACTS+'''SELECT m.id AS machine_id,m.code,m.name,m.department,
          count(f.report_id) AS report_count,max(f.reported_at) AS last_reported_at
          FROM sentinel.machines m LEFT JOIN facts f ON f.machine_id=m.id
          WHERE m.organization_id=%s GROUP BY m.id,m.code,m.name,m.department ORDER BY report_count DESC,m.code''',params+(org,))
        machines=cur.fetchall()
        cur.execute(FACTS+'''SELECT department,count(*) AS report_count,
          count(DISTINCT machine_id) AS machines_with_reports FROM facts
          GROUP BY department ORDER BY report_count DESC,department NULLS LAST''',params)
        departments=cur.fetchall()
        cur.execute(FACTS+'SELECT count(*) AS total FROM ('+REPEATS+') grouped',params)
        repeats_total=cur.fetchone()['total']
        cur.execute(FACTS+REPEATS+' ORDER BY report_count DESC,last_reported_at DESC,machine_code,reported_issue LIMIT 21 OFFSET %s',params+(issue_offset,))
        repeats=cur.fetchall()
        cur.execute(FACTS+'''SELECT work_outcome AS outcome,count(*) AS report_count FROM facts
          WHERE work_status='completed' GROUP BY work_outcome ORDER BY work_outcome''',params)
        outcomes=cur.fetchall()
        cur.execute(FACTS+'''SELECT technician_id,technician_name,
          count(*) FILTER(WHERE work_status='assigned') AS assigned,
          count(*) FILTER(WHERE work_status='in_progress') AS in_progress,
          count(*) FILTER(WHERE work_status='completed') AS completed
          FROM facts WHERE work_id IS NOT NULL GROUP BY technician_id,technician_name
          ORDER BY technician_name,technician_id''',params)
        technicians=cur.fetchall()
        cur.execute(FACTS+'''SELECT created_by_account_id AS account_id,submitter_username AS username,
          submitter_name AS display_name,count(*) AS report_count FROM facts
          GROUP BY created_by_account_id,submitter_username,submitter_name
          ORDER BY report_count DESC,submitter_username NULLS LAST''',params)
        submitters=cur.fetchall()
    return {'days':days,'counts':counts,'machines':machines,'departments':departments,
      'repeated_issues':repeats[:20],'issue_offset':issue_offset,'issue_has_more':len(repeats)>20,'issue_total':repeats_total,
      'outcomes':outcomes,'technicians':technicians,'submitters':submitters,
      'method':'Latest human fact review per report; current machine links; latest work event on the selected review. Issue groups match after lowercasing and whitespace normalization only.'}
