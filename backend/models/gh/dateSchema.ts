import { z } from "zod";
export const DateSchema = z.string().pipe(z.coerce.date());
