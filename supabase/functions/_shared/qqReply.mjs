export function splitQqReply(text) {
    const parts = [];
    let start = 0;
    let depth = 0;
    let quote = null;
    const close = { '“': '”', '「': '」', '『': '』', '"': '"' };
    for (let i = 0; i < text.length; i++) {
        const c = text[i], next = text[i + 1] || '';
        if (c === '\\') {
            i++;
            continue;
        }
        if (quote) {
            if (c === quote)
                quote = null;
            continue;
        }
        if (close[c]) {
            quote = close[c];
            continue;
        }
        if (c === '（' || c === '(') {
            depth++;
            continue;
        }
        if (c === '）' || c === ')') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth)
            continue;
        if (c === '\n' || /[。！？!?]/.test(c) || c === '.' && (!next || /\s/.test(next))) {
            let end = i + 1;
            if (c === '\n') {
                while (end < text.length && text[end] === '\n')
                    end++;
            }
            else {
                while (end < text.length && /[。！？!?]/.test(text[end]))
                    end++;
                while (end < text.length && /[ \t]/.test(text[end]))
                    end++;
            }
            const part = text.slice(start, end);
            if (part.trim()) {
                parts.push(part);
                start = end;
            }
            i = end - 1;
        }
    }
    if (start < text.length) {
        const tail = text.slice(start);
        if (tail.trim())
            parts.push(tail);
        else if (parts.length)
            parts[parts.length - 1] += tail;
    }
    if (!parts.length)
        return [text];
    const packed = [];
    for (const p of parts) {
        if (p.length > 1200) {
            for (let at = 0; at < p.length; at += 1000)
                packed.push(p.slice(at, at + 1000).trim());
            continue;
        }
        if (packed.length >= 31) {
            packed[packed.length - 1] += ' ' + p.trim();
            continue;
        }
        packed.push(p.trim());
    }
    if (packed.some(p => p.length > 1200) || packed.length > 32) {
        const safe = [];
        for (const part of packed)
            for (let at = 0; at < part.length; at += 1000)
                safe.push(part.slice(at, at + 1000).trim());
        return safe.length <= 32 && safe.join('').replace(/\s/g, '') === text.replace(/\s/g, '') ? safe : [text.trim()];
    }
    return packed.join('').replace(/\s/g, '') === text.replace(/\s/g, '') ? packed : [text.trim()];
}
