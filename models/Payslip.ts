import { Schema, model, models } from "mongoose";
import { IPayslip } from "@/types";
const PayslipSchema = new Schema<IPayslip>({ tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true }, employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true }, month: { type: Number, required: true, min: 1, max: 12 }, year: { type: Number, required: true }, grossSalary: { type: Number, required: true }, cnssEmployee: { type: Number, required: true }, cnssEmployer: { type: Number, required: true }, otherDeductions: { type: Number, default: 0 }, netSalary: { type: Number, required: true }, isPaid: { type: Boolean, default: false }, paidAt: Date }, { timestamps: true });
PayslipSchema.index({ tenantId: 1, employeeId: 1, year: 1, month: 1 }, { unique: true });
export const PayslipModel = models.Payslip || model<IPayslip>("Payslip", PayslipSchema);
