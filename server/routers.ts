import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { addToWaitlist, getReservationForUser, reservePassForGuest, reservePassForUser } from "./db";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  waitlist: router({
    join: publicProcedure
      .input(
        z.object({
          name: z.string().trim().min(2, "Please add your name.").max(160),
          email: z.string().trim().email("Please use a valid email.").max(320),
        }),
      )
      .mutation(async ({ input }) => {
        const result = await addToWaitlist(input.name, input.email);
        return { success: true, alreadyJoined: result.alreadyJoined } as const;
      }),
  }),
  event: router({
    myPass: protectedProcedure.query(({ ctx }) => getReservationForUser(ctx.user.id)),
    reservePass: protectedProcedure.mutation(({ ctx }) =>
      reservePassForUser(ctx.user.id, ctx.user.name ?? "Afro Kravings guest", ctx.user.email ?? null),
    ),
    reserveGuestPass: publicProcedure
      .input(z.object({ name: z.string().trim().min(2, "Please add your name.").max(160), email: z.string().trim().email("Please use a valid email.").max(320) }))
      .mutation(({ input }) => reservePassForGuest(input.name, input.email)),
  }),
});

export type AppRouter = typeof appRouter;
