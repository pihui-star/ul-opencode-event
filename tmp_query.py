import sqlite3, json, shutil

src = '/data/opencode.db'
dst = '/tmp/oc.db'
shutil.copy2(src, dst)
for ext in ['-wal', '-shm']:
    try:
        shutil.copy2(src + ext, dst + ext)
    except FileNotFoundError:
        pass

conn = sqlite3.connect(dst)
conn.row_factory = sqlite3.Row

sid = 'ses_264622af3ffeywFhsvQj4XPiyT'

# 1. Check session table
print('=== TABLES ===')
for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
    print(' ', r[0])

print()
print('=== SESSION DATA ===')
try:
    sess = conn.execute('SELECT * FROM session WHERE id = ?', (sid,)).fetchone()
    if sess:
        for k in sess.keys():
            v = sess[k]
            if isinstance(v, str) and len(v) > 300:
                print('  %s: %s...' % (k, v[:300]))
            else:
                print('  %s: %s' % (k, v))
    else:
        print('  No session row found')
except Exception as e:
    print('  Error:', e)

# 2. Messages near 125.4K total
print()
print('=== MESSAGES WHERE total NEAR 125.4K ===')
all_msgs = conn.execute('SELECT rowid, data FROM message WHERE session_id = ? ORDER BY rowid ASC', (sid,)).fetchall()
for row in all_msgs:
    d = json.loads(row['data'])
    tks = d.get('tokens', {})
    if not tks:
        continue
    total = tks.get('total', 0)
    if 120000 <= total <= 135000:
        inp = tks.get('input', 0)
        out = tks.get('output', 0)
        reas = tks.get('reasoning', 0)
        cache = tks.get('cache', {})
        cr = cache.get('read', 0) if isinstance(cache, dict) else 0
        print('rowid=%d total=%d in=%d out=%d reas=%d cr=%d' % (row['rowid'], total, inp, out, reas, cr))

# 3. Last 5 messages detail
print()
print('=== LAST 5 MESSAGES ===')
msgs = conn.execute('SELECT rowid, data FROM message WHERE session_id = ? ORDER BY rowid DESC LIMIT 5', (sid,)).fetchall()
for row in msgs:
    d = json.loads(row['data'])
    role = d.get('role', '?')
    tks = d.get('tokens', {})
    print('rowid=%d role=%s' % (row['rowid'], role))
    if tks:
        inp = tks.get('input', 0)
        out = tks.get('output', 0)
        reas = tks.get('reasoning', 0)
        cache = tks.get('cache', {})
        cr = cache.get('read', 0) if isinstance(cache, dict) else 0
        cc = cache.get('creation', 0) if isinstance(cache, dict) else 0
        total = tks.get('total', 0)
        print('  in=%d out=%d reas=%d cr=%d cc=%d total=%d' % (inp, out, reas, cr, cc, total))
        print('  in+cr = %d (%.1fK)' % (inp + cr, (inp + cr) / 1000))
        print('  in+out+reas = %d (%.1fK)' % (inp + out + reas, (inp + out + reas) / 1000))
    print()

# 4. Check event table - try without type filter
print('=== ALL EVENTS FOR SESSION ===')
evt_count = conn.execute('SELECT COUNT(*) FROM event WHERE aggregate_id = ?', (sid,)).fetchone()[0]
print('Total events:', evt_count)
evts = conn.execute('SELECT type, data FROM event WHERE aggregate_id = ? ORDER BY rowid DESC LIMIT 10', (sid,)).fetchall()
for r in evts:
    d = json.loads(r['data'])
    print('type=%s keys=%s' % (r['type'], sorted(d.keys())[:15]))
    # Check for any token/cost data
    for k in d:
        kl = k.lower()
        if any(x in kl for x in ['token', 'usage', 'cost', 'total']):
            print('  %s = %s' % (k, json.dumps(d[k]) if isinstance(d[k], (dict, list)) else d[k]))

# 5. Check session table columns
print()
print('=== SESSION TABLE COLUMNS ===')
try:
    for c in conn.execute('PRAGMA table_info(session)').fetchall():
        print('  %s (%s)' % (c[1], c[2]))
except:
    print('  No session table')

# 6. Try computing: sum of (input + output) only, or other combos
print()
print('=== LAST MSG BREAKDOWN ===')
last = conn.execute('SELECT data FROM message WHERE session_id = ? ORDER BY rowid DESC LIMIT 1', (sid,)).fetchone()
if last:
    d = json.loads(last['data'])
    tks = d.get('tokens', {})
    if tks:
        inp = tks.get('input', 0)
        out = tks.get('output', 0)
        reas = tks.get('reasoning', 0)
        cache = tks.get('cache', {})
        cr = cache.get('read', 0) if isinstance(cache, dict) else 0
        total = tks.get('total', 0)
        print('Last msg: in=%d out=%d reas=%d cr=%d total=%d' % (inp, out, reas, cr, total))
        print('total = in + out + reas + cr? %d vs %d (match=%s)' % (inp + out + reas + cr, total, inp + out + reas + cr == total))

# 7. Key metric: what does the UI actually show?
# UI likely shows SUM of (output + reasoning) across all turns, which = "generated tokens"
# Or it shows the last message's total = "context window size"
# Or: input + cache_read of last message = "total tokens in context"
print()
print('=== OPENCODE UI TOKEN METRIC INVESTIGATION ===')
# The OpenCode UI typically shows the context window usage of the LAST message
# Let's compute various "last message" metrics
msgs_all = conn.execute('SELECT rowid, data FROM message WHERE session_id = ? ORDER BY rowid ASC', (sid,)).fetchall()
assistant_with_tokens = []
for row in msgs_all:
    d = json.loads(row['data'])
    tks = d.get('tokens', {})
    if d.get('role') == 'assistant' and tks and (tks.get('input', 0) > 0 or tks.get('output', 0) > 0):
        cache = tks.get('cache', {})
        assistant_with_tokens.append({
            'input': tks.get('input', 0),
            'output': tks.get('output', 0),
            'reasoning': tks.get('reasoning', 0),
            'cache_read': cache.get('read', 0) if isinstance(cache, dict) else 0,
            'total': tks.get('total', 0),
        })

last_m = assistant_with_tokens[-1]
print('Last assistant msg:')
print('  input=%d output=%d reasoning=%d cache_read=%d total=%d' % (
    last_m['input'], last_m['output'], last_m['reasoning'], last_m['cache_read'], last_m['total']))
print('  input + cache_read = %d (%.1fK) <- total context tokens' % (last_m['input'] + last_m['cache_read'], (last_m['input'] + last_m['cache_read']) / 1000))

# Maybe UI shows SUM of output across all messages? Or a different session?
# The 125.4K could be from a specific point in time (snapshot)
# Check message #44 which had total=125422 very close to 125.4K
print()
print('=== MESSAGE #44 ANALYSIS (total=125422) ===')
m44 = assistant_with_tokens[43]  # 0-indexed
print('  input=%d output=%d reasoning=%d cache_read=%d total=%d' % (
    m44['input'], m44['output'], m44['reasoning'], m44['cache_read'], m44['total']))
print('  This message total (125422) is extremely close to 125.4K!')
print('  The UI likely showed THIS snapshot at some point.')

# The 125.4K is likely the context window size at message #44
# which was probably the last message at the time the user observed it

conn.close()
