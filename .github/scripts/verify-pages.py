import re
import sys
import time
from html.parser import HTMLParser
from urllib.parse import urljoin
from urllib.request import Request, urlopen

site = sys.argv[1].rstrip('/') + '/'


def fetch(url):
    request = Request(url, headers={'User-Agent': 'ODTT-Pages-Check'})
    with urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f'{url}: HTTP {response.status}')
        return response.read()


class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if tag == 'script' and attributes.get('src'):
            self.urls.append(attributes['src'])
        if tag == 'link' and attributes.get('rel') == 'stylesheet':
            self.urls.append(attributes['href'])


for attempt in range(6):
    try:
        page = fetch(site).decode('utf-8')
        if '<title>ODTT — On Demand Tactical Terrain</title>' not in page:
            raise RuntimeError('The published page does not contain the ODTT title.')
        if '<option value="lapalma" selected>La Palma</option>' not in page:
            raise RuntimeError('La Palma is not the published default preset.')
        if 'Scott Air Force Base' in page or 'RAF Mildenhall' in page:
            raise RuntimeError('An air force base preset is still present.')
        assets = Assets()
        assets.feed(page)
        for asset in assets.urls:
            fetch(urljoin(site, asset))
        worker = fetch(urljoin(site, 'assets/model.worker.js')).decode('utf-8')
        wasm = re.findall(r'manifold-[A-Za-z0-9_-]+\.wasm', worker)
        if not wasm:
            raise RuntimeError('The model worker does not reference its geometry WASM file.')
        for asset in set(wasm):
            fetch(urljoin(site, 'assets/' + asset))
        print('Verified ODTT page, JavaScript, stylesheet, model worker and geometry WASM.')
        break
    except Exception as error:
        print(f'Attempt {attempt + 1}: {error}')
        if attempt == 5:
            raise
        time.sleep(10)
