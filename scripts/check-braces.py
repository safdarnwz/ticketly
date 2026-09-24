import sys

def check(path):
    content = open(path).read()
    depth = 0
    line_num = 1
    in_string = None
    in_comment_line = False
    in_comment_block = False
    i = 0
    issues = []
    while i < len(content):
        c = content[i]
        if c == '\n':
            line_num += 1
            in_comment_line = False
        if in_comment_line:
            i += 1
            continue
        if in_comment_block:
            if c == '*' and i + 1 < len(content) and content[i + 1] == '/':
                in_comment_block = False
                i += 2
                continue
            i += 1
            continue
        if in_string:
            if c == '\\':
                i += 2
                continue
            if c == in_string:
                in_string = None
            i += 1
            continue
        if c == '/' and i + 1 < len(content) and content[i + 1] == '/':
            in_comment_line = True
            i += 1
            continue
        if c == '/' and i + 1 < len(content) and content[i + 1] == '*':
            in_comment_block = True
            i += 2
            continue
        if c in '"\'`':
            in_string = c
            i += 1
            continue
        if c == '{':
            depth += 1
        if c == '}':
            depth -= 1
            if depth < 0:
                issues.append(line_num)
        i += 1
    status = 'OK' if depth == 0 and not issues else 'BROKEN'
    print(f'{status}  depth={depth}  negative_at={issues[:5]}  {path}')

for p in sys.argv[1:]:
    check(p)
