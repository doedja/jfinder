import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit, releaseTask } from '../src/lib/utils/rate-limiter.ts';

function createMockRequest(ip = '127.0.0.1'): Request {
  return new Request('http://localhost/api/test', {
    headers: { 'x-forwarded-for': ip }
  });
}

describe('rate-limiter', () => {
  it('allows first request', () => {
    const req = createMockRequest('10.0.0.1');
    const result = checkRateLimit(req);
    assert.equal(result, null);
    releaseTask(req);
  });

  it('allows requests from different IPs', () => {
    const req1 = createMockRequest('10.0.1.1');
    const req2 = createMockRequest('10.0.1.2');
    assert.equal(checkRateLimit(req1), null);
    assert.equal(checkRateLimit(req2), null);
    releaseTask(req1);
    releaseTask(req2);
  });
});
