import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { ProductModel } from "@/models/Product";

export const GET = withAuth("services", "read", async (req: NextRequest, auth: any) => {
  await connectDB();
  // On récupère uniquement les services (isService: true)
  const services = await ProductModel.find({ 
    ...tenantFilter(auth), 
    isService: true 
  }).sort({ label: 1 });
  
  return ok(services);
});

export const POST = withAuth("services", "create", async (req: NextRequest, auth: any) => {
  try {
    await connectDB();
    const body = await req.json();
    
    const service = await ProductModel.create({ 
      ...body, 
      tenantId: auth.tenantId,
      isService: true // On force à true pour cette route
    });
    
    return NextResponse.json({ data: service }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
});