const crypto = require('node:crypto');
const { promisify } = require('node:util');
const bcrypt = require('bcryptjs');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_HASH = `scrypt$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(KEY_LENGTH).toString('base64url')}`;
const BCRYPT_ROUNDS = 12;
const DUMMY_BCRYPT_HASH = bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyScryptPassword(password, encoded) {
  const [algorithm, saltText, hashText] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) {
    await scrypt(password, Buffer.alloc(16), KEY_LENGTH, OPTIONS);
    return false;
  }

  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(hashText, 'base64url');
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) {
    await scrypt(password, Buffer.alloc(16), KEY_LENGTH, OPTIONS);
    return false;
  }
  const actual = await scrypt(password, salt, KEY_LENGTH, OPTIONS);
  return crypto.timingSafeEqual(actual, expected);
}

async function verifyPassword(password, encoded) {
  if (typeof encoded !== 'string' || !encoded) {
    await bcrypt.compare(password, await DUMMY_BCRYPT_HASH);
    return false;
  }
  if (encoded.startsWith('$2')) {
    return Buffer.byteLength(password, 'utf8') <= 72 && bcrypt.compare(password, encoded);
  }
  if (encoded.startsWith('scrypt$')) return verifyScryptPassword(password, encoded);
  await verifyScryptPassword(password, DUMMY_HASH);
  return false;
}

module.exports = { hashPassword, verifyPassword };
