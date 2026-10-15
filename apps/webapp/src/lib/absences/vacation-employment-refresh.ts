import "server-only";
import {and,eq,isNotNull} from "drizzle-orm";
import {employee,vacationAdjustment} from "@/db/schema";
import type {AbsenceDaysDatabase} from "./absence-days-resolver";
import {loadEmployeeEmployments,loadEmployeeVacationOverrides} from "./prorated-allowance-store";
import {accruingEmployments,FIRST_ACCRUAL_CATCH_UP_YEAR,monthlyAccrualDays} from "./vacation-accrual";
import {isAccrualPolicy} from "./vacation-policy-settings";
import {loadCompanyDefaultVacationPolicy} from "./vacation-policy-store";
import {plainDateAt,type Instant} from "@/lib/datetime/temporal-core";
export type EmploymentVacationRefresh={accruals:Array<{id:string|null;year:number;month:number;days:string|null}>;accrualSums:Map<number,number>};
/** Reuses the scheduled job's grant rule; only derived period grants may change. */
export async function planEmploymentVacationRefresh(client:AbsenceDaysDatabase,input:{organizationId:string;employeeId:string;employmentStartDate:string;timezone:string;now:Instant}):Promise<EmploymentVacationRefresh>{
 const today=plainDateAt(input.now,input.timezone);
 const [employment,existing]=await Promise.all([
 loadEmployeeEmployments(client,{organizationId:input.organizationId,employeeIds:[input.employeeId],employeeEmploymentStartDateOverrides:new Map([[input.employeeId,input.employmentStartDate]])}),
 client.select({id:vacationAdjustment.id,year:vacationAdjustment.year,month:vacationAdjustment.accrualMonth,days:vacationAdjustment.days}).from(vacationAdjustment).innerJoin(employee,eq(employee.id,vacationAdjustment.employeeId)).where(and(eq(employee.organizationId,input.organizationId),eq(vacationAdjustment.employeeId,input.employeeId),eq(vacationAdjustment.kind,"accrual")))
 ]);
 const person=employment.get(input.employeeId);
 const result:EmploymentVacationRefresh={accruals:[],accrualSums:new Map()};
 if(!person)return result;
 for(let year=FIRST_ACCRUAL_CATCH_UP_YEAR;year<=Math.max(today.year,...existing.map(row=>row.year));year++){
  const policy=await loadCompanyDefaultVacationPolicy(client,{organizationId:input.organizationId,year});
  if(!policy || !isAccrualPolicy(policy))continue;
  const overrides=await loadEmployeeVacationOverrides(client,{organizationId:input.organizationId,employeeIds:[input.employeeId],year});
  const annualDays=Number(overrides.get(input.employeeId)?.customAnnualDays || policy.defaultAnnualDays);
  const months=new Set(existing.filter(row=>row.year===year&&row.month!==null).map(row=>row.month!));
  const throughMonth=year<today.year?12:year===today.year?today.month:0;
  for(let month=1;month<=throughMonth;month++)months.add(month);
  let sum=existing.filter(row=>row.year===year && row.month===null).reduce((total,row)=>total+Number(row.days),0);
  for(const month of [...months].sort((a,b)=>a-b)){
   const share=monthlyAccrualDays({accrualType:policy.accrualType,annualDays,year,month,employments:accruingEmployments(person)});
   const days=share===null?null:share.toFixed(2);
   sum+=Number(days??0);
   result.accruals.push({id:existing.find(row=>row.year===year&&row.month===month)?.id??null,year,month,days});
  }
  result.accrualSums.set(year,sum);
 }
 return result;
}
/** Caller owns the employee/configuration guards and transaction; manual adjustments stay intact. */
export async function applyEmploymentVacationRefresh(client:AbsenceDaysDatabase,input:{organizationId:string;employeeId:string;plan:EmploymentVacationRefresh}){
 const [target]=await client.select({id:employee.id}).from(employee).where(and(eq(employee.organizationId,input.organizationId),eq(employee.id,input.employeeId)));
 if(!target)throw new Error("Employee outside organization");
 for(const row of input.plan.accruals){
  if(row.id){
   const scope=and(eq(vacationAdjustment.id,row.id),eq(vacationAdjustment.employeeId,input.employeeId),eq(vacationAdjustment.kind,"accrual"),isNotNull(vacationAdjustment.accrualMonth));
   if(row.days===null)await client.delete(vacationAdjustment).where(scope);
   else await client.update(vacationAdjustment).set({days:row.days,reason:`Monthly accrual for ${row.year}-${String(row.month).padStart(2,"0")}: +${row.days} days (reviewed employment correction)`}).where(scope);
  }else if(row.days!==null)await client.insert(vacationAdjustment).values({employeeId:input.employeeId,year:row.year,accrualMonth:row.month,days:row.days,kind:"accrual",adjustedBy:null,reason:`Monthly accrual for ${row.year}-${String(row.month).padStart(2,"0")}: +${row.days} days (reviewed employment correction)`});
 }
}
