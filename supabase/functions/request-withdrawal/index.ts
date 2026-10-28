import { createWithdrawalHandler } from "./handler.js";

Deno.serve(createWithdrawalHandler({ env: Deno.env.toObject() }));
