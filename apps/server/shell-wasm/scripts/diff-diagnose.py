import sys
a = open(sys.argv[1], "rb").read()
b = open(sys.argv[2], "rb").read()
print("sizes", len(a), len(b))
def leb(d, i):
    r = s = 0
    while True:
        x = d[i]; i += 1; r |= (x & 127) << s; s += 7
        if x < 128: return r, i
def secs(d):
    i, out = 8, []
    while i < len(d):
        n, j = leb(d, i + 1); out.append((d[i], i, n)); i = j + n
    return out
print("sections committed", secs(a))
print("sections rebuilt  ", secs(b))
diff = [k for k in range(min(len(a), len(b))) if a[k] != b[k]]
print("differing bytes", len(diff))
print("first", diff[:40])
print("last", diff[-10:])
if diff:
    k = diff[0]
    print("committed", a[k - 24:k + 40].hex())
    print("rebuilt  ", b[k - 24:k + 40].hex())
