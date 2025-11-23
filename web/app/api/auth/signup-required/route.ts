import { NextResponse } from 'next/server';

export async function GET() {
  const signupCode = process.env.SIGNUP_CODE;
  
  return NextResponse.json({
    required: !!signupCode,
  });
}
