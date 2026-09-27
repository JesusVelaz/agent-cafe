/**
 * Arithmetic evaluator for the `calculator` tool. A small recursive-descent parser,
 * so model-supplied input never reaches eval/Function.
 *
 *   expr   = term (('+' | '-') term)*
 *   term   = power (('*' | '/' | '%') power)*
 *   power  = unary ('^' power)?          // right-associative
 *   unary  = ('-' | '+') unary | primary
 *   primary = number | '(' expr ')'
 */
export function evaluate(input: string): number {
  if (input.length > 500) throw new Error('Expression too long');
  const src = input.replace(/\s+/g, '');
  let pos = 0;

  const peek = () => src[pos];
  const fail = (msg: string): never => {
    throw new Error(`${msg} at position ${pos}`);
  };

  function expr(): number {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[pos++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  function term(): number {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = src[pos++];
      const r = power();
      if ((op === '/' || op === '%') && r === 0) fail('Division by zero');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }

  function power(): number {
    const base = unary();
    if (peek() === '^') {
      pos++;
      return base ** power();
    }
    return base;
  }

  function unary(): number {
    if (peek() === '-') {
      pos++;
      return -unary();
    }
    if (peek() === '+') {
      pos++;
      return unary();
    }
    return primary();
  }

  function primary(): number {
    if (peek() === '(') {
      pos++;
      const v = expr();
      if (peek() !== ')') fail('Expected ")"');
      pos++;
      return v;
    }
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(pos));
    if (!m) return fail('Expected a number');
    pos += m[0].length;
    return Number(m[0]);
  }

  const result = expr();
  if (pos !== src.length) fail('Unexpected input');
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number');
  return result;
}
