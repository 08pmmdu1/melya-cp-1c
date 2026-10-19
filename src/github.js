import https from 'node:https';
import http from 'node:http';

const HEADERS = {
  'user-agent': 'melya-cp-1c',
  accept: 'application/vnd.github+json',
};

export function getJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http:') ? http : https;
    const req = mod.get(url, { headers: HEADERS }, (res) => {
      const code = res.statusCode || 0;
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        body += d;
      });
      res.on('end', () => {
        if (code === 403 || code === 429) {
          reject(
            new Error(
              `GitHub API вернул ${code} (лимит запросов или приватный репозиторий). ` +
                'Укажите точную версию через --pin <id>=<version> вместо --latest.',
            ),
          );
          return;
        }
        if (code !== 200) {
          reject(new Error(`GitHub API вернул ${code} для ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Некорректный JSON от ${url}: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('Таймаут запроса к GitHub API')));
  });
}

export function latestRelease(repo) {
  return getJson(`https://api.github.com/repos/${repo}/releases/latest`);
}

export function releaseByTag(repo, tag) {
  return getJson(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
}
