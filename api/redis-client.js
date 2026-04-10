const Redis = require('ioredis');

let client = null;

function getRedisClient() {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL env var is not set');
    client = new Redis(url, {
      tls: { servername: url.split('@')[1]?.split(':')[0] },
      connectTimeout: 10000,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    });
  }
  return client;
}

async function kvGet(key) {
  const redis = getRedisClient();
  const val = await redis.get(key);
  return val ?? null;
}

async function kvSet(key, value, exSeconds) {
  const redis = getRedisClient();
  if (exSeconds) {
    await redis.set(key, typeof value === 'string' ? value : JSON.stringify(value), 'EX', exSeconds);
  } else {
    await redis.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
}

async function kvDel(key) {
  const redis = getRedisClient();
  await redis.del(key);
}

async function kvIncr(key) {
  const redis = getRedisClient();
  const result = await redis.incr(key);
  return result;
}

async function kvLpush(key, value) {
  const redis = getRedisClient();
  const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
  await redis.lpush(key, valueStr);
}

async function kvLpushWithTrim(key, value, maxLength) {
  const redis = getRedisClient();
  const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
  await redis.lpush(key, valueStr);
  await redis.ltrim(key, 0, maxLength - 1);
}

async function kvLrange(key, start, stop) {
  const redis = getRedisClient();
  const results = await redis.lrange(key, start, stop);
  return results || [];
}

async function kvList(key) {
  const redis = getRedisClient();
  const results = await redis.lrange(key, 0, -1);
  return results || [];
}

module.exports = {
  getRedisClient,
  kvGet,
  kvSet,
  kvDel,
  kvIncr,
  kvLpush,
  kvLpushWithTrim,
  kvLrange,
  kvList
};
