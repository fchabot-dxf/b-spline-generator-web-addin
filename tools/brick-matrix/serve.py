"""The brick matrix's static server: `python -m http.server`, with a real listen backlog.

Item 74k (seat D, measured): under the gate's load the stock server's backlog of 5 (socketserver.TCPServer
.request_queue_size) refused module requests (net::ERR_CONNECTION_REFUSED / ERR_NO_BUFFER_SPACE) -- one failed
module and the app's whole module graph is dead: no editor, the splash up, and the group died "no bricks laid at
baseline". Stock: 4 of 27 loaded pages stuck that way; with this server 0 of 9 failed a request (same load).

Usage: python serve.py <port>   (serves the current directory on 127.0.0.1)
"""
import functools
import http.server
import sys

REQUEST_QUEUE_SIZE = 128  # the listen backlog (stock: 5)


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = REQUEST_QUEUE_SIZE
    daemon_threads = True


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # the matrix ignores the server's output, as with -m http.server
        pass


if __name__ == '__main__':
    port = int(sys.argv[1])
    Server(('127.0.0.1', port), functools.partial(QuietHandler, directory='.')).serve_forever()
