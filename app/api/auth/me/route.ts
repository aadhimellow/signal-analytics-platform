import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
export async function GET() { return NextResponse.json({ user: await currentUser() }); }
