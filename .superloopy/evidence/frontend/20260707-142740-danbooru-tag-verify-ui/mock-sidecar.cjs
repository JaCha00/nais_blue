const http = require('http')

const payload = {
    results: [
        { raw: '1girl', normalized: '1girl', postCount: 7200000, status: 'OK', suggestions: [], error: null },
        { raw: 'cinematic lighting', normalized: 'cinematic_lighting', postCount: 56, status: 'LOW', suggestions: [], error: null },
        {
            raw: 'ghost_tag_sample',
            normalized: 'ghost_tag_sample',
            postCount: 0,
            status: 'GHOST',
            suggestions: [
                { name: 'glowing_eyes', postCount: 151000 },
                { name: 'blue_eyes', postCount: 3440000 },
                { name: 'looking_at_viewer', postCount: 2580000 },
            ],
            error: null,
        },
        { raw: 'network_probe', normalized: 'network_probe', postCount: null, status: 'ERROR', suggestions: [], error: 'mocked upstream timeout' },
        { raw: '<hair>', normalized: '', postCount: null, status: 'SKIPPED', suggestions: [], error: null },
    ],
}

http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')

    if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
    }

    if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
    }

    if (req.url === '/danbooru/verify-prompt' && req.method === 'POST') {
        req.on('data', () => {})
        req.on('end', () => {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify(payload))
        })
        return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
}).listen(8002, '127.0.0.1')
