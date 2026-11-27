import { GatewayError } from './adapter';
import { gatewayFetch } from './http';

describe('gatewayFetch error classification', () => {
  afterEach(() => jest.restoreAllMocks());

  const respond = (status: number) =>
    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response('{"error":{"message":"provider said no"}}', {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

  it('keeps the status for definite client rejections', async () => {
    respond(400);
    await expect(gatewayFetch('https://provider.test/x')).rejects.toMatchObject(
      {
        status: 400,
        message: 'provider said no',
      },
    );
  });

  it.each([429, 500, 502, 503])(
    'drops the status for HTTP %s because the outcome is unknown',
    async (status) => {
      respond(status);
      expect.assertions(2);
      try {
        await gatewayFetch('https://provider.test/x');
      } catch (e) {
        expect(e).toBeInstanceOf(GatewayError);
        expect((e as GatewayError).status).toBeUndefined();
      }
    },
  );
});
