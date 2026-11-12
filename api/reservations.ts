import type { IncomingMessage, ServerResponse } from "node:http";
import { handleReservationsRequest } from "../server/bookingHttp";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handleReservationsRequest(req, res);
}
