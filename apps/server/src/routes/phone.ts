/**
 * "Connect your phone": the café page on this computer turns phone access on or off and gets the
 * pairing link to show as a QR code. Never from a phone: the link is the key to the café.
 */
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RemoteSetupError } from '../network.js';
import type { PhoneAccess } from '../phone.js';
import { isRemote } from '../remote.js';

const StartBody = z.object({ via: z.string().trim().min(1) });

export const phoneRoutes =
  (phone: PhoneAccess): FastifyPluginAsync =>
  async (app) => {
    const localOnly = async (req: FastifyRequest, reply: FastifyReply) => {
      if (isRemote(req)) return reply.code(403).send({ error: 'Phone access can only be changed on the computer running the café.' });
    };

    app.get('/api/phone', { onRequest: localOnly }, async () => ({ available: phone.available, sharing: phone.status() }));

    app.post('/api/phone', { onRequest: localOnly }, async (req, reply) => {
      const { via } = StartBody.parse(req.body);
      try {
        return { available: phone.available, sharing: await phone.start(via) };
      } catch (err) {
        if (err instanceof RemoteSetupError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

    app.delete('/api/phone', { onRequest: localOnly }, async () => {
      await phone.stop();
      return { available: phone.available, sharing: null };
    });
  };
