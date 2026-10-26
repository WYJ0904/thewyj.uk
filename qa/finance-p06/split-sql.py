"""Use SQLite's own statement-completeness parser for the actual migration."""
import json,sqlite3,sys
statements=[];pending=''
for char in sys.stdin.read():
    pending+=char
    if char==';' and sqlite3.complete_statement(pending):
        statements.append(pending);pending=''
assert not pending.strip(), 'Unterminated migration statement'
print(json.dumps(statements))
