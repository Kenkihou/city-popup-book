"""飛び出す絵本を開くための開発用サーバー（04_earth-simulator から）。

なぜ素の `python -m http.server` を使わないのか
------------------------------------------------
素の http.server は Cache-Control を一切返さない。ブラウザはその場合
Last-Modified からの経過時間を見て【勝手に】キャッシュを効かせる（発見的キャッシュ）。
その結果、js を書き換えて再読み込みしても古いモジュールが動き続けることがある。

実際にこれを踏んだ：建物の透過度を 0 にすると選び直せない不具合を直したのに、
直っていないように見えた。サーバーは新しいファイルを返せる状態だったのに、
ブラウザが取りに来ていなかった。

そこで、開発中は必ず取りに来させる（no-store）。
本番配信（GitHub Pages など）には関係しない、手元専用の入口。

使い方:  python serve.py [ポート]   （既定 8765）
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    # 画面の「output/ に保存」を受ける（開発用。output/ の下にだけ書く）
    def do_POST(self):
        import json, pathlib
        if not self.path.startswith('/save'):
            self.send_error(404); return
        n = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(n).decode('utf-8'))
        name = pathlib.PurePosixPath(body.get('name', '')).name
        if not name or '..' in name:
            self.send_error(400); return
        root = pathlib.Path(__file__).resolve().parent / 'output'
        root.mkdir(exist_ok=True)
        data = body.get('data', '')
        if body.get('base64'):
            import base64
            (root / name).write_bytes(base64.b64decode(data))
        else:
            (root / name).write_text(data, encoding='utf-8')
        out = json.dumps({'saved': str(root / name)}).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, fmt, *args):
        # 1リクエストごとの行は多すぎて、肝心の失敗が流れてしまう。
        # 失敗（4xx/5xx）だけ出す。
        status = args[1] if len(args) > 1 else ''
        if isinstance(status, str) and status[:1] in ('4', '5'):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(('', port), handler) as httpd:
        print(f'serving {root} on http://localhost:{port}/ (no-store)')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
