#!/usr/bin/env python3
"""Local dev server that disables all caching, so the browser always loads
the latest files. Run: python3 serve.py"""
import http.server

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    port = 8765
    server = http.server.ThreadingHTTPServer(('0.0.0.0', port), NoCacheHandler)
    print(f'Serving on http://localhost:{port} (no-cache)')
    server.serve_forever()
