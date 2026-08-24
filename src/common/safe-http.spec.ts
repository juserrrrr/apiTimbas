import { isPublicIp } from './safe-http';

describe('isPublicIp', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    'fd00::1',
  ])('rejects private or reserved address %s', (address) =>
    expect(isPublicIp(address)).toBe(false),
  );

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])(
    'allows public address %s',
    (address) => expect(isPublicIp(address)).toBe(true),
  );
});
