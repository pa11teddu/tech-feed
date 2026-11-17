import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    await supabase.auth.signOut();
  } catch {
    // Missing env or network: still send the user to /login.
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
