"""
Dynasty Dashboard — local dev server
Run with:  python serve.py
Then open: http://localhost:8000
"""

import http.server
import socketserver
import webbrowser
import os

PORT = 8000
DIR  = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def log_message(self, fmt, *args):
        # Suppress the per-request noise; only show errors
        if int(args[1]) >= 400:
            super().log_message(fmt, *args)

if __name__ == '__main__':
    with socketserver.TCPServer(('', PORT), Handler) as httpd:
        url = f'http://localhost:{PORT}'
        print(f'Dynasty Dashboard running at {url}')
        print('Press Ctrl+C to stop.\n')
        webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nServer stopped.')
