"""Local administrator console. Passwords are prompted and never printed."""
import argparse
import getpass
import re
from uuid import UUID
from app.database import get_connection, get_demo_organization_id
from app.accounts import hash_password

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    create = sub.add_parser('create')
    create.add_argument('username');create.add_argument('--name', required=True)
    create.add_argument('--role', choices=['owner','worker','technician'], required=True)
    create.add_argument('--technician-code')
    sub.add_parser('list')
    for name in ('reset-password','disable','enable'):
        cmd = sub.add_parser(name);cmd.add_argument('username')
    args = parser.parse_args()
    org = get_demo_organization_id()
    password = None
    if args.command in ('create','reset-password'):
        password = getpass.getpass('New password (at least 12 characters): ')
        if len(password)<12 or len(password)>256 or password != getpass.getpass('Repeat password: '):
            parser.exit(1,'Passwords must match and contain 12–256 characters.\n')
    with get_connection() as conn:
        if args.command=='list':
            for row in conn.execute('SELECT username,display_name,role,active FROM sentinel.accounts WHERE organization_id=%s ORDER BY username',(org,)):
                print(' | '.join(str(v) for v in row))
            return
        username=args.username.strip().lower()
        if args.command=='create':
            if not re.fullmatch(r'[a-z0-9][a-z0-9_.-]{2,63}', username) or not 1<=len(args.name.strip())<=100:
                parser.exit(1,'Use a 3–64 character username and a 1–100 character display name.\n')
            technician=None
            if args.role=='technician':
                row=conn.execute('SELECT id FROM sentinel.technicians WHERE organization_id=%s AND code=%s',(org,args.technician_code)).fetchone()
                if not row:parser.exit(1,'Choose an existing technician code, such as TECH-A.\n')
                technician=row[0]
            elif args.technician_code:
                parser.exit(1,'Only technician accounts use a technician code.\n')
            conn.execute('INSERT INTO sentinel.accounts(organization_id,username,display_name,password_hash,role,technician_id) VALUES(%s,%s,%s,%s,%s,%s)',(org,username,args.name.strip(),hash_password(password),args.role,technician))
        else:
            row=conn.execute('SELECT id FROM sentinel.accounts WHERE organization_id=%s AND username=%s FOR UPDATE',(org,username)).fetchone()
            if not row:parser.exit(1,'Account not found.\n')
            if args.command=='reset-password':
                conn.execute('UPDATE sentinel.accounts SET password_hash=%s WHERE id=%s',(hash_password(password),row[0]))
            else:
                conn.execute('UPDATE sentinel.accounts SET active=%s WHERE id=%s',(args.command=='enable',row[0]))
            conn.execute('DELETE FROM sentinel.sessions WHERE account_id=%s',(row[0],))
    print('Account change saved.')

if __name__=='__main__':
    try:main()
    except Exception as error:
        print('Account setup failed ('+type(error).__name__+'). Check migration 008, unique username, and technician code. No passwords were printed.')
        raise SystemExit(1)
