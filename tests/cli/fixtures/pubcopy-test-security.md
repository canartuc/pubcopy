# Security Test

<script>alert('xss')</script>

Normal paragraph.

<iframe src="https://evil.com"></iframe>

<img src="x" onerror="alert(1)">

==highlighted text==

> [!warning] Be careful
> This is important

- [ ] Unchecked task
- [x] Checked task

```mermaid
graph TD
A --> B
```

Inline math: $x^2 + y^2 = z^2$

Block math:
$$
\sum_{i=0}^{n} i = \frac{n(n+1)}{2}
$$
