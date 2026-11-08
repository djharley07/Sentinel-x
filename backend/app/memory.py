"""Read-only retrieval of earlier reviewed reports for the same demo machine."""
import re
from uuid import UUID
from fastapi import APIRouter, HTTPException, Response
from app.fact_reviews import scoped_connection

router=APIRouter(prefix='/api',tags=['Operational Memory'])
STOP={'a','an','the','is','are','was','were','has','have','had','it','its','of','to','in','on','and','or','with','from','for','making','reported','issue','machine','motor','pump'}

def words(text):
    if not isinstance(text,str):return set()
    return {w for w in re.findall(r'[^\W_]+',text.casefold(),re.UNICODE) if len(w)>2 and w not in STOP and not w.isdigit()}

def rank_candidates(rows,issue):
    terms=words(issue)
    matches=[]
    for r in rows:
        shared=sorted(terms & words(r[3].get('reported_issue')))
        if not shared:continue
        union=terms | words(r[3].get('reported_issue'))
        matches.append((len(shared)/len(union),r,shared))
    # Stable tie-breaking: input is newest first.
    matches.sort(key=lambda v:v[0],reverse=True)
    return [{'report_id':str(r[0]),'attempt_id':str(r[1]),'attempt_number':r[2],
        'facts':r[3],'report_created_at':r[4].isoformat(),'verified_transcript':r[5],
        'shared_issue_words':shared,'latest_repair':r[6] if len(r)>6 else None} for _,r,shared in matches[:10]]

@router.get('/fact-reviews/{review_id}/memory')
def memory(review_id:UUID,response:Response):
    response.headers['Cache-Control']='no-store'
    with scoped_connection() as (conn,org):
        # All source and candidate rows are read by one statement, sharing one snapshot.
        rows=conn.execute('''
        WITH reviewed AS (
          SELECT r.id AS review_id,a.report_id,a.id AS attempt_id,a.attempt_number,
            r.facts,p.created_at AS report_created_at,
            CASE WHEN tr.decision='corrected' THEN tr.corrected_transcript ELSE a.original_transcript END AS transcript,
            CASE WHEN link.id IS NOT NULL THEN link.machine_id ELSE r.machine_id END AS machine_id
          FROM sentinel.extraction_reviews r
          JOIN sentinel.report_extractions x ON x.id=r.extraction_id AND x.organization_id=r.organization_id
          JOIN sentinel.transcription_attempts a ON a.id=x.attempt_id AND a.organization_id=x.organization_id
          JOIN sentinel.reports p ON p.id=a.report_id AND p.organization_id=a.organization_id
          JOIN sentinel.transcription_reviews tr ON tr.attempt_id=a.id AND tr.organization_id=a.organization_id
          LEFT JOIN LATERAL (SELECT id,machine_id FROM sentinel.machine_link_events e
             WHERE e.review_id=r.id AND e.organization_id=r.organization_id
             ORDER BY sequence_number DESC LIMIT 1) link ON true
          WHERE r.organization_id=%s AND tr.decision IN ('accepted','corrected')
        ), source AS (SELECT * FROM reviewed WHERE review_id=%s), candidates AS (
          SELECT DISTINCT ON (c.report_id) c.* FROM reviewed c JOIN source s
            ON c.machine_id=s.machine_id
          WHERE c.report_id<>s.report_id AND c.report_created_at<s.report_created_at
          ORDER BY c.report_id,c.attempt_number DESC
        )
        SELECT s.report_id,s.machine_id,s.facts,m.name,m.code,
          c.report_id,c.attempt_id,c.attempt_number,c.facts,c.report_created_at,c.transcript,repair.summary
        FROM source s LEFT JOIN sentinel.machines m ON m.id=s.machine_id AND m.organization_id=%s
        LEFT JOIN (SELECT * FROM candidates ORDER BY report_created_at DESC,report_id DESC LIMIT 101) c ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_build_object('status',e.status,'action_note',e.action_note,'outcome',e.outcome,
             'technician_name',t.name,'created_at',e.created_at,'machine_id',e.machine_id,'machine_name',rm.name) AS summary
          FROM sentinel.repair_events e
          JOIN sentinel.technicians t ON t.id=e.technician_id AND t.organization_id=e.organization_id
          JOIN sentinel.machines rm ON rm.id=e.machine_id AND rm.organization_id=e.organization_id
          WHERE e.review_id=c.review_id AND e.organization_id=%s ORDER BY e.sequence_number DESC LIMIT 1
        ) repair ON true
        ORDER BY c.report_created_at DESC,c.report_id DESC
        ''',(org,review_id,org,org)).fetchall()
    if not rows:raise HTTPException(404,'Reviewed report not found.')
    first=rows[0]
    machine_id=first[1]
    candidates=[r[5:] for r in rows if r[5] is not None]
    examined=candidates[:100]
    matches=rank_candidates(examined,first[2].get('reported_issue')) if machine_id else []
    return {'review_id':str(review_id),'report_id':str(first[0]),
      'machine_id':str(machine_id) if machine_id else None,'machine_name':first[3],'machine_code':first[4],
      'reported_issue':first[2].get('reported_issue'),'method':'shared_issue_words_v1',
      'examined_reports':len(examined),'search_truncated':len(candidates)>100,
      'matches':matches,'requires_human_review':True}
