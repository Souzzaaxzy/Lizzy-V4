/**
 * Free Fire API Module - FFAPIS Implementation
 * Based on https://github.com/senoseya/ffapis
 * Uses Garena authentication with guest accounts
 */

import axios from 'axios';
import crypto from 'crypto';
import protobuf from 'protobufjs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROTO_DIR = path.join(__dirname, '../proto');

// AES Encryption settings
const AE_MAIN_KEY = Buffer.from('Yg&tc%DEuh6%Zc^8', 'binary');
const AE_MAIN_IV = Buffer.from('6oyZDr22E3ychjM%', 'binary');

// Garena Auth Headers
const GARENA_AUTH_HEADERS = {
  'User-Agent': 'GarenaMSDK/4.0.19P9(A063 ;Android 13;en;BR;)',
  'Connection': 'Keep-Alive',
  'Accept-Encoding': 'gzip'
};

// Garena Client Config
const GARENA_CLIENT_ID = '100067';
const GARENA_CLIENT_SECRET = '2ee44819e9b4598845141067b281621874d0d5d7af9d8f7e00c1e54715b7d1e3';

// URLs
const URL_GARENA_TOKEN = 'https://ffmconnect.live.gop.garenanow.com/oauth/guest/token/grant';
const URL_MAJOR_LOGIN = 'https://loginbp.ggblueshark.com/MajorLogin';
const URL_SEARCH = (serverUrl) => `${serverUrl}/FuzzySearchAccountByName`;
const URL_PERSONAL_SHOW = (serverUrl) => `${serverUrl}/GetPlayerPersonalShow`;
const URL_PLAYER_STATS = (serverUrl) => `${serverUrl}/GetPlayerStats`;
const URL_PLAYER_CS_STATS = (serverUrl) => `${serverUrl}/GetPlayerTCStats`;

// Release Version (OB53 - pode precisar atualizar com updates)
const RELEASE_VERSION = 'OB53';

// Common Headers
const COMMON_HEADERS = {
  'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 13; A063 Build/TKQ1.221220.001)',
  'Connection': 'Keep-Alive',
  'Accept-Encoding': 'gzip',
  'Expect': '100-continue',
  'X-Unity-Version': '2018.4.11f1',
  'X-GA': 'v1 1',
  'ReleaseVersion': RELEASE_VERSION
};

// Proto Handler
class ProtoHandler {
  constructor() {
    this.roots = {};
  }

  async load(filename) {
    if (!this.roots[filename]) {
      this.roots[filename] = await protobuf.load(path.join(PROTO_DIR, filename));
    }
    return this.roots[filename];
  }

  async encode(filename, messageName, payload, shouldEncrypt = true) {
    const root = await this.load(filename);
    const Type = root.lookupType(messageName);
    const message = Type.create(payload);
    const buffer = Type.encode(message).finish();

    if (shouldEncrypt) {
      return this.encrypt(Buffer.from(buffer));
    }
    return Buffer.from(buffer);
  }

  async decode(filename, messageName, buffer) {
    const root = await this.load(filename);
    const Type = root.lookupType(messageName);
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const message = Type.decode(buf);
    return Type.toObject(message, {
      longs: String,
      enums: String,
      bytes: String,
      defaults: true,
      arrays: true
    });
  }

  encrypt(buffer) {
    const cipher = crypto.createCipheriv('aes-128-cbc', AE_MAIN_KEY, AE_MAIN_IV);
    return Buffer.concat([cipher.update(buffer), cipher.final()]);
  }
}

const protoHandler = new ProtoHandler();

// Session Manager
class SessionManager {
  constructor() {
    this.token = null;
    this.serverUrl = null;
    this.openId = null;
    this.accountId = null;
  }

  setSession(session) {
    this.token = session.token;
    this.serverUrl = session.serverUrl;
    this.openId = session.openId;
    this.accountId = session.accountId;
  }

  isValid() {
    return !!(this.token && this.serverUrl);
  }
}

// Credential Manager
class CredentialManager {
  constructor(region = 'BR') {
    this.region = region.toUpperCase();
    this.credentials = [];
    this.currentIndex = 0;
    this.loadCredentials();
  }

  loadCredentials() {
    // Load credentials from database/dono directory
    const credFile = path.join(__dirname, `../../database/dono/ff_credentials_${this.region.toLowerCase()}.json`);
    
    try {
      if (fs.existsSync(credFile)) {
        const data = JSON.parse(fs.readFileSync(credFile, 'utf8'));
        this.credentials = data.credentials || [];
      }
    } catch (e) {
      console.log(`[FFAPIS] Arquivo de credenciais não encontrado: ${credFile}`);
    }
    
    // Fallback: usar credenciais vazias para tentar guest register
    if (this.credentials.length === 0) {
      console.log('[FFAPIS] Nenhuma credencial carregada. Sistema tentará guest register.');
    }
  }

  getCredential() {
    if (this.credentials.length === 0) return null;
    this.currentIndex = (this.currentIndex + 1) % this.credentials.length;
    return this.credentials[this.currentIndex];
  }

  getRandomCredential() {
    if (this.credentials.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * this.credentials.length);
    return this.credentials[randomIndex];
  }
}

// Main API Class
class FreeFireAPI {
  constructor(region = 'BR') {
    this.region = region.toUpperCase();
    this.session = new SessionManager();
    this.credentialManager = new CredentialManager(region);
    this.lastRequestTime = 0;
    this.requestCooldown = 1000; // 1 second between requests
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async waitForCooldown() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.requestCooldown) {
      await this.sleep(this.requestCooldown - timeSinceLastRequest);
    }
    this.lastRequestTime = Date.now();
  }

  async getGarenaToken(uid, password) {
    const params = new URLSearchParams();
    params.append('uid', uid);
    params.append('password', password);
    params.append('response_type', 'token');
    params.append('client_type', '2');
    params.append('client_secret', GARENA_CLIENT_SECRET);
    params.append('client_id', GARENA_CLIENT_ID);

    try {
      const response = await axios.post(URL_GARENA_TOKEN, params, {
        headers: GARENA_AUTH_HEADERS,
        timeout: 30000
      });
      return response.data;
    } catch (error) {
      throw new Error(`Garena Auth Failed: ${error.message}`);
    }
  }

  async majorLogin(accessToken, openId) {
    const payload = {
      openid: openId,
      logintoken: accessToken,
      platform: '4'
    };

    const encryptedBody = await protoHandler.encode('MajorLogin.proto', 'request', payload, true);

    try {
      const response = await axios.post(URL_MAJOR_LOGIN, encryptedBody, {
        headers: {
          ...COMMON_HEADERS,
          Authorization: 'Bearer',
          'Content-Type': 'application/octet-stream'
        },
        responseType: 'arraybuffer',
        timeout: 30000
      });

      const decoded = await protoHandler.decode('MajorLogin.proto', 'response', response.data);
      return decoded;
    } catch (error) {
      throw new Error(`Major Login Failed: ${error.message}`);
    }
  }

  async majorRegister(openId, token, region) {
    const payload = {
      openid: openId,
      logintoken: token,
      region: region,
      platform: '4'
    };

    const encryptedBody = await protoHandler.encode('MajorRegister.proto', 'request', payload, true);

    try {
      const response = await axios.post(URL_MAJOR_LOGIN.replace('MajorLogin', 'MajorRegister'), encryptedBody, {
        headers: {
          ...COMMON_HEADERS,
          Authorization: 'Bearer',
          'Content-Type': 'application/octet-stream'
        },
        responseType: 'arraybuffer',
        timeout: 30000
      });

      const decoded = await protoHandler.decode('MajorRegister.proto', 'response', response.data);
      return decoded;
    } catch (error) {
      throw new Error(`Major Register Failed: ${error.message}`);
    }
  }

  async login(uid, password) {
    if (!uid || !password) {
      throw new Error('Missing credentials. Please provide UID and PASSWORD.');
    }

    const garenaData = await this.getGarenaToken(uid, password);
    if (!garenaData?.access_token) {
      throw new Error('Garena authentication failed: Invalid credentials');
    }

    const loginData = await this.majorLogin(garenaData.access_token, garenaData.open_id);
    if (!loginData?.token) {
      throw new Error('Major login failed: Empty token received');
    }

    const session = {
      token: loginData.token,
      serverUrl: loginData.serverUrl,
      openId: garenaData.open_id,
      accountId: loginData.accountid
    };

    this.session.setSession(session);
    return session;
  }

  async loginWithRandomCredential(maxRetries = 3) {
    const cred = this.credentialManager.getRandomCredential();
    if (!cred) {
      throw new Error('No credentials available');
    }
    
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.login(cred.uid, cred.password);
      } catch (error) {
        lastError = error;
        console.log(`[FFAPIS] Login attempt ${i + 1} failed: ${error.message}`);
        
        // Se for erro de servidor (5xx), esperar e tentar novamente
        if (error.message.includes('503') || error.message.includes('502') || error.message.includes('timeout')) {
          const waitTime = (i + 1) * 2000;
          console.log(`[FFAPIS] Waiting ${waitTime}ms before retry...`);
          await this.sleep(waitTime);
        } else {
          // Se for outro erro, não tentar novamente
          break;
        }
      }
    }
    
    throw lastError;
  }

  async ensureSession() {
    if (!this.session.isValid()) {
      await this.loginWithRandomCredential();
    }
  }

  async searchAccount(keyword) {
    await this.waitForCooldown();
    await this.ensureSession();

    if (keyword.length < 3) {
      throw new Error('Search keyword must be at least 3 characters');
    }

    const payload = { keyword: String(keyword) };
    const encryptedBody = await protoHandler.encode('SearchAccountByName.proto', 'SearchAccountByName.request', payload, true);

    try {
      const response = await axios.post(URL_SEARCH(this.session.serverUrl), encryptedBody, {
        headers: {
          ...COMMON_HEADERS,
          Authorization: `Bearer ${this.session.token}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        responseType: 'arraybuffer',
        timeout: 30000
      });

      const data = await protoHandler.decode('SearchAccountByName.proto', 'SearchAccountByName.response', response.data);
      return data.infos || [];
    } catch (error) {
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        this.session.token = null; // Force re-login
        return this.searchAccount(keyword); // Retry
      }
      throw new Error(`Search Failed: ${error.message}`);
    }
  }

  async getPlayerProfile(uid, retries = 3) {
    await this.waitForCooldown();
    await this.ensureSession();

    const payload = {
      accountId: BigInt(uid),
      callSignSrc: 0,
      needGalleryInfo: true
    };

    const encryptedBody = await protoHandler.encode('PlayerPersonalShow.proto', 'PlayerPersonalShow.request', payload, true);

    try {
      const response = await axios.post(URL_PERSONAL_SHOW(this.session.serverUrl), encryptedBody, {
        headers: {
          ...COMMON_HEADERS,
          Authorization: `Bearer ${this.session.token}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        responseType: 'arraybuffer',
        timeout: 30000
      });

      const data = await protoHandler.decode('PlayerPersonalShow.proto', 'PlayerPersonalShow.response', response.data);
      return this.parseProfileResponse(data);
    } catch (error) {
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        this.session.token = null;
        return this.getPlayerProfile(uid, 0); // Não retry após re-login
      }
      
      // Retry em caso de erro de servidor
      if (retries > 0 && (error.message.includes('503') || error.message.includes('timeout'))) {
        console.log(`[FFAPIS] Server error, retrying... (${retries} left)`);
        await this.sleep(2000);
        return this.getPlayerProfile(uid, retries - 1);
      }
      
      throw new Error(`Get Profile Failed: ${error.message}`);
    }
  }

  async getPlayerStats(uid, mode = 'br', matchType = 'career') {
    await this.waitForCooldown();
    await this.ensureSession();

    const gameMode = mode === 'cs' ? 2 : 1;
    const matchMode = matchType === 'ranked' ? 2 : 1;

    const payload = {
      accountId: BigInt(uid),
      gameMode: gameMode,
      matchMode: matchMode
    };

    try {
      const protoFile = mode === 'cs' ? 'PlayerCSStats.proto' : 'PlayerStats.proto';
      const messageName = mode === 'cs' ? 'PlayerCSStats.request' : 'PlayerStats.request';
      const responseName = mode === 'cs' ? 'PlayerCSStats.response' : 'PlayerStats.response';

      const encryptedBody = await protoHandler.encode(protoFile, messageName, payload, true);

      const url = mode === 'cs' ? URL_PLAYER_CS_STATS(this.session.serverUrl) : URL_PLAYER_STATS(this.session.serverUrl);

      const response = await axios.post(url, encryptedBody, {
        headers: {
          ...COMMON_HEADERS,
          Authorization: `Bearer ${this.session.token}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        responseType: 'arraybuffer',
        timeout: 30000
      });

      const data = await protoHandler.decode(protoFile, responseName, response.data);
      return this.parseStatsResponse(data, mode);
    } catch (error) {
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        this.session.token = null;
        return this.getPlayerStats(uid, mode, matchType);
      }
      throw new Error(`Get Stats Failed: ${error.message}`);
    }
  }

  parseProfileResponse(data) {
    const basicInfo = data.basicinfo || {};
    const clanInfo = data.clanbasicinfo || {};
    const petInfo = data.petinfo || {};
    const profileInfo = data.profileinfo || {};
    const socialInfo = data.socialinfo || {};
    const captainInfo = data.captainbasicinfo || {};
    const creditInfo = data.creditscoreinfo || {};

    return {
      basicinfo: {
        accountid: String(basicInfo.accountid || ''),
        nickname: basicInfo.nickname || '',
        level: basicInfo.level || 0,
        region: basicInfo.region || this.region,
        exp: basicInfo.exp || 0,
        liked: basicInfo.liked || 0,
        rank: basicInfo.rank || 0,
        csrank: basicInfo.csrank || 0,
        seasonid: basicInfo.seasonid || 0,
        lastloginat: basicInfo.lastloginat || 0,
        createat: basicInfo.createat || 0
      },
      claninfo: {
        clanid: String(clanInfo.clanid || ''),
        clanname: clanInfo.clanname || '',
        captainid: String(clanInfo.captainid || ''),
        clanlevel: clanInfo.clanlevel || 0,
        capacity: clanInfo.capacity || 0,
        membernum: clanInfo.membernum || 0
      },
      petinfo: {
        id: petInfo.id || 0,
        name: petInfo.name || '',
        level: petInfo.level || 0,
        exp: petInfo.exp || 0
      },
      profileinfo: {
        avatarid: profileInfo.avatarid || 0,
        skincolor: profileInfo.skincolor || 0,
        clothes: profileInfo.clothes || [],
        equipedskills: profileInfo.equipedskills || []
      },
      socialinfo: {
        accountid: String(socialInfo.accountid || ''),
        gender: socialInfo.gender || 0,
        language: socialInfo.language || 0,
        signature: socialInfo.signature || ''
      },
      captainbasicinfo: {
        accountid: String(captainInfo.accountid || ''),
        nickname: captainInfo.nickname || '',
        level: captainInfo.level || 0
      },
      creditscoreinfo: {
        creditscore: creditInfo.creditscore || 0,
        isinit: creditInfo.isinit || false
      },
      raw: data
    };
  }

  parseStatsResponse(data, mode) {
    if (mode === 'cs') {
      return {
        gameMode: 'cs',
        maxrank: data.maxrank || 0,
        matches: data.matches || 0,
        kills: data.kills || 0,
        headshotkills: data.headshotkills || 0,
        assist: data.assist || 0,
        win: data.win || 0,
        loss: data.loss || 0,
        draw: data.draw || 0,
        mvps: data.mvp || data.mvps || 0,
        raw: data
      };
    }

    return {
      gameMode: 'br',
      maxrank: data.maxrank || 0,
      matches: data.matches || 0,
      kills: data.kills || 0,
      headshotkills: data.headshotkills || 0,
      assist: data.assist || 0,
      win: data.win || 0,
      death: data.death || 0,
      kd: data.kills && data.death ? (data.kills / Math.max(1, data.death)).toFixed(2) : '0.00',
      raw: data
    };
  }
}

// Export singleton instance
const apiInstance = new FreeFireAPI();

export const searchAccount = (keyword) => apiInstance.searchAccount(keyword);
export const getPlayerProfile = (uid) => apiInstance.getPlayerProfile(uid);
export const getPlayerStats = (uid, mode, matchType) => apiInstance.getPlayerStats(uid, mode, matchType);
export const FreeFireAPIInstance = apiInstance;

export default apiInstance;
