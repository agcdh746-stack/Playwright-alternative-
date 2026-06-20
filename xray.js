'use strict';

// YT Studio এর xray.js থেকে নেওয়া — same pattern
const { spawn, execSync } = require('child_process');
const fs = require('fs');

const XRAY_BIN    = process.env.XRAY_BIN    || '/usr/local/bin/xray';
const XRAY_CONFIG = process.env.XRAY_CONFIG || '/app/data/xray-config.json';
const SOCKS_PORT  = parseInt(process.env.XRAY_SOCKS_PORT || '10808', 10);
const HTTP_PORT   = parseInt(process.env.XRAY_HTTP_PORT  || '10809', 10);
const LOCAL_PROXY = `socks5://127.0.0.1:${SOCKS_PORT}`;

let xrayProc = null;

function decodeVmess(link) {
  const b64 = link.replace(/^vmess:\/\//i, '').trim();
  const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  return {
    type: 'vmess',
    address: json.add, port: parseInt(json.port, 10),
    uuid: json.id, alterId: parseInt(json.aid || '0', 10),
    network: json.net || 'tcp',
    security: json.tls === 'tls' ? 'tls' : 'none',
    host: json.host || json.add, path: json.path || '/',
    sni: json.sni || json.host || json.add,
  };
}

function decodeVless(link) {
  const m = link.match(/^vless:\/\/([^@]+)@([^:/?]+):(\d+)(\?[^#]*)?/i);
  if (!m) throw new Error('VLESS parse failed');
  const [, uuid, host, port, qs] = m;
  const p = new URLSearchParams((qs || '').replace(/^\?/, ''));
  return {
    type: 'vless', address: host, port: parseInt(port, 10), uuid,
    network: p.get('type') || 'tcp', security: p.get('security') || 'none',
    host: p.get('host') || host, path: p.get('path') || '/',
    sni: p.get('sni') || host, flow: p.get('flow') || '',
  };
}

function decodeLink(link) {
  link = String(link || '').trim();
  if (!link) throw new Error('empty link');
  if (/^vmess:\/\//i.test(link))   return decodeVmess(link);
  if (/^vless:\/\//i.test(link))   return decodeVless(link);
  if (/^socks5?:\/\//i.test(link)) return { type: 'passthrough', url: link };
  throw new Error('Unsupported scheme');
}

function buildXrayConfig(d) {
  const ss = { network: d.network || 'tcp' };
  if (d.security === 'tls') {
    ss.security = 'tls';
    ss.tlsSettings = { serverName: d.sni || d.address, allowInsecure: false };
  }
  if (d.network === 'ws') ss.wsSettings = { path: d.path || '/', headers: { Host: d.host } };

  const outbound = d.type === 'vmess' ? {
    tag: 'proxy', protocol: 'vmess',
    settings: { vnext: [{ address: d.address, port: d.port, users: [{ id: d.uuid, alterId: d.alterId, security: 'auto' }] }] },
    streamSettings: ss
  } : {
    tag: 'proxy', protocol: 'vless',
    settings: { vnext: [{ address: d.address, port: d.port, users: [{ id: d.uuid, encryption: 'none', flow: d.flow }] }] },
    streamSettings: ss
  };

  return {
    log: { loglevel: 'warning' },
    inbounds: [
      { tag: 'socks-in', listen: '127.0.0.1', port: SOCKS_PORT, protocol: 'socks', settings: { auth: 'noauth', udp: true } },
      { tag: 'http-in',  listen: '127.0.0.1', port: HTTP_PORT,  protocol: 'http',  settings: {} },
    ],
    outbounds: [outbound, { tag: 'direct', protocol: 'freedom', settings: {} }],
  };
}

function stopXray() {
  if (xrayProc) { try { xrayProc.kill('SIGTERM'); } catch (_) {} xrayProc = null; }
}

function startXray() {
  if (!fs.existsSync(XRAY_BIN)) { console.log('xray binary not found — proxy disabled'); return false; }
  const link = process.env.VMESS_LINK || '';
  if (!link) { console.log('VMESS_LINK not set — proxy disabled'); return false; }

  try {
    const decoded = decodeLink(link);
    if (decoded.type === 'passthrough') {
      process.env.HTTPS_PROXY = decoded.url;
      process.env.HTTP_PROXY  = decoded.url;
      console.log('✓ Direct proxy set');
      return true;
    }
    const cfg = buildXrayConfig(decoded);
    fs.mkdirSync(require('path').dirname(XRAY_CONFIG), { recursive: true });
    fs.writeFileSync(XRAY_CONFIG, JSON.stringify(cfg, null, 2));

    xrayProc = spawn(XRAY_BIN, ['run', '-c', XRAY_CONFIG], { stdio: ['ignore', 'pipe', 'pipe'] });
    xrayProc.stdout.on('data', d => console.log('xray>', d.toString().trim()));
    xrayProc.stderr.on('data', d => console.warn('xray>', d.toString().trim()));
    xrayProc.on('exit', code => { console.warn(`xray exited: ${code}`); xrayProc = null; });

    process.env.HTTPS_PROXY = LOCAL_PROXY;
    process.env.HTTP_PROXY  = LOCAL_PROXY;
    console.log(`✓ Xray started: ${decoded.type} → ${decoded.address}:${decoded.port}`);
    return true;
  } catch (e) {
    console.error('Xray start failed:', e.message);
    return false;
  }
}

module.exports = { startXray, stopXray, LOCAL_PROXY };
