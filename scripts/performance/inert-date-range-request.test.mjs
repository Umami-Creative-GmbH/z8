import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {inertDateRangeRequestLimits,parseInertDateRangeRequest,readInertDateRangeRequestValue,forgetInertDateRangeRequestValue} from "./inert-date-range-request.mjs";

const range=()=>({start:"$D2025-01-01T00:00:00.000Z",end:"$D2025-01-02T00:00:00.000Z",startDate:"2025-01-01",endDate:"2025-01-02",timezone:"SYNTHETIC_PRIVATE_ZONE"});
const bytes=value=>Buffer.from(JSON.stringify([value]));
test("inert DateRange request syntax consumes one duplicate-free argument without exporting its values",()=>{
	const input=bytes(range()),result=parseInertDateRangeRequest(input);assert.equal(result.known,true);assert.equal(result.protocol,"inert-date-range-request-v1");
	assert.equal(result.encodedBytes,input.length);assert.equal(result.bodySha256,createHash("sha256").update(input).digest("hex"));assert.equal(result.duplicateKeys,"absent");assert.equal(result.sourceBound,false);assert.equal(result.requestEOFClaim,false);assert.equal(result.acceptanceClaim,"none");
	assert.doesNotMatch(JSON.stringify(result),/2025-01|SYNTHETIC_PRIVATE_ZONE|\$D/);
	const value=readInertDateRangeRequestValue(result);assert.equal(value.kind,"date-range");assert.equal(value.start.kind,"react-date");assert.equal(value.start.iso,"2025-01-01T00:00:00.000Z");assert.equal(value.timezone.kind,"literal-string");assert.equal(value.timezone.text,"SYNTHETIC_PRIVATE_ZONE");
	assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(value));assert.ok(Object.isFrozen(value.start));assert.equal(readInertDateRangeRequestValue({...result}),null);
});

test("inert request duplicates are rejected after decoding property names and before creating a descriptor",()=>{
	for(const key of Object.keys(range()))for(const escaped of [false,true]){
		const entries=Object.entries(range()).map(([k,value])=>JSON.stringify(k)+":"+JSON.stringify(value));
		const duplicate=escaped?'"\\u'+key.charCodeAt(0).toString(16).padStart(4,"0")+key.slice(1)+'"':JSON.stringify(key);
		entries.push(duplicate+':"PRIVATE_DUPLICATE_VALUE"');const result=parseInertDateRangeRequest(Buffer.from('[{'+entries.join(",")+'}]'));
		assert.equal(result.known,false);assert.equal(result.reason,"duplicate-field");assert.equal(result.duplicateKeys,"unproved");assert.equal(readInertDateRangeRequestValue(result),null);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|SYNTHETIC_|2025-01/);
	}
});

test("inert request grammar requires exactly five string fields in one object argument",()=>{
	const good=range();
	for(const input of [JSON.stringify(good),"[]",JSON.stringify([good,good]),JSON.stringify([[good]]),JSON.stringify([{...good,PRIVATE_EXTRA:"PRIVATE_VALUE"}]),JSON.stringify([good])+" false","[{]","[{}]",JSON.stringify([good]).replace('}]',',}]')])assert.equal(parseInertDateRangeRequest(Buffer.from(input)).known,false);
	for(const field of Object.keys(good)){
		const missing={...good};delete missing[field];assert.equal(parseInertDateRangeRequest(bytes(missing)).reason,"missing-field");
		for(const value of [null,false,42,[],{},["$1"]])assert.equal(parseInertDateRangeRequest(bytes({...good,[field]:value})).known,false);
	}
	for(const key of ["__proto__","constructor","prototype","toJSON","start:alias"]){const input='[{'+Object.entries(good).map(([k,v])=>JSON.stringify(k)+":"+JSON.stringify(v)).join(",")+','+JSON.stringify(key)+':"PRIVATE"}]';assert.equal(parseInertDateRangeRequest(Buffer.from(input)).reason,"unsupported-field");}
});

test("inert request literal fields preserve React dollar escaping without treating literals as references",()=>{
	for(const field of ["startDate","endDate","timezone"]){
		for(const wire of ["$$L9","$$D2025-01-01T00:00:00.000Z","$$","$$$1"]){const result=parseInertDateRangeRequest(bytes({...range(),[field]:wire}));assert.equal(result.known,true);assert.equal(readInertDateRangeRequestValue(result)[field].kind,"literal-string");assert.equal(readInertDateRangeRequestValue(result)[field].text,wire.slice(1));}
		for(const wire of ["$L9","$@1","$T0:0","$1:field","$undefined","$Sreact.fragment","$D2025-01-01T00:00:00.000Z","$"])assert.equal(parseInertDateRangeRequest(bytes({...range(),[field]:wire})).reason,"unsupported-protocol-string");
	}
	const escaped=Buffer.from(JSON.stringify([range()]).replace('"SYNTHETIC_PRIVATE_ZONE"','"\\u0024\\u0024L9"'));
	assert.equal(readInertDateRangeRequestValue(parseInertDateRangeRequest(escaped)).timezone.text,"$L9");
	for(const text of ["",'quotes " and slash \\ and newline\n',"π😀"]){const parsed=parseInertDateRangeRequest(bytes({...range(),timezone:text}));assert.equal(parsed.known,true);assert.equal(readInertDateRangeRequestValue(parsed).timezone.text,text);}
	assert.equal(parseInertDateRangeRequest(Buffer.from(JSON.stringify([range()]).replace('"SYNTHETIC_PRIVATE_ZONE"','"\\ud800"'))).reason,"unsupported-unicode");
});

test("inert request Date fields require canonical external React serialization without business interpretation",()=>{
	for(const field of ["start","end"]){
		for(const wire of ["$Dinvalid","$D2025-02-30T00:00:00.000Z","$D2025-01-01","$D2025-01-01T00:00:00Z","$D2025-01-01T00:00:00.000+00:00","$$D2025-01-01T00:00:00.000Z","$L1"])assert.equal(parseInertDateRangeRequest(bytes({...range(),[field]:wire})).reason,"noncanonical-date");
		for(const iso of ["0000-01-01T00:00:00.000Z","2000-02-29T23:59:59.999Z","+010000-01-01T00:00:00.000Z","-000001-01-01T00:00:00.000Z"]){const result=parseInertDateRangeRequest(bytes({...range(),[field]:"$D"+iso}));assert.equal(result.known,true);assert.equal(readInertDateRangeRequestValue(result)[field].iso,iso);}
	}
	const reversed=parseInertDateRangeRequest(bytes({...range(),start:range().end,end:range().start,startDate:"not-a-calendar-date",endDate:"",timezone:"not-an-IANA-zone"}));assert.equal(reversed.known,true,"This module proves serialization shape, not range order or timezone business rules.");
});

test("inert request parser bounds raw bytes Unicode and grammar work before retaining any value",()=>{
	const empty={...range(),timezone:""},base=bytes(empty),padding="x".repeat(inertDateRangeRequestLimits.encodedBytes-base.length),exact=bytes({...empty,timezone:padding});assert.equal(exact.length,16384);
	const parsed=parseInertDateRangeRequest(exact);assert.equal(parsed.known,true);assert.ok(parsed.work>0&&parsed.work<=65536);assert.equal(parsed.maxDepth,2);assert.ok(parsed.punctuation<=32);
	const overflow=parseInertDateRangeRequest(Buffer.concat([exact,Buffer.from(" ")]));assert.equal(overflow.reason,"byte-limit");assert.equal(overflow.bodySha256,null);assert.equal(overflow.work,0);
	for(const input of [undefined,null,"PRIVATE",[],{}]){const result=parseInertDateRangeRequest(input);assert.equal(result.reason,"invalid-input");assert.equal(result.bodySha256,null);assert.equal(readInertDateRangeRequestValue(result),null);}
	assert.equal(parseInertDateRangeRequest(Buffer.from([255])).reason,"invalid-utf8");assert.equal(parseInertDateRangeRequest(Buffer.concat([Buffer.from([239,187,191]),bytes(range())])).known,false);
	assert.equal(parseInertDateRangeRequest(Buffer.from(new SharedArrayBuffer(10))).reason,"shared-input");
	for(const input of [Buffer.from('[{"start":'+"[".repeat(1000)),Buffer.from('[{"start":"'+"\\".repeat(1000)),Buffer.alloc(0)]){const result=parseInertDateRangeRequest(input);assert.equal(result.known,false);assert.ok(result.work<=65536);assert.equal(readInertDateRangeRequestValue(result),null);}
});

test("inert request descriptors are immutable commitments independent of later input-buffer mutation",()=>{
	const input=bytes(range()),result=parseInertDateRangeRequest(input),value=readInertDateRangeRequestValue(result),before=JSON.stringify(result);input.fill(0);
	assert.equal(JSON.stringify(result),before);assert.equal(value.start.iso,"2025-01-01T00:00:00.000Z");assert.throws(()=>{value.start.iso="PRIVATE_MUTATION";},TypeError);
	assert.throws(()=>{value.timezone.text="PRIVATE_MUTATION";},TypeError);assert.equal(readInertDateRangeRequestValue(structuredClone(result)),null);
	for(const key of [null,undefined,false,1,"PRIVATE",{},()=>{}])assert.equal(readInertDateRangeRequestValue(key),null);
	const reversed=Object.fromEntries(Object.entries(range()).reverse()),second=parseInertDateRangeRequest(bytes(reversed));assert.equal(second.valueDescriptorSha256,result.valueDescriptorSha256);assert.notEqual(second.bodySha256,result.bodySha256);
});

test("inert request value release removes the actual private value without mutating retained safe facts",()=>{
	const descriptor=parseInertDateRangeRequest(bytes(range())),before=JSON.stringify(descriptor);
	assert.equal(forgetInertDateRangeRequestValue({...descriptor}),false);
	assert.notEqual(readInertDateRangeRequestValue(descriptor),null);
	assert.equal(forgetInertDateRangeRequestValue(descriptor),true);
	assert.equal(readInertDateRangeRequestValue(descriptor),null);
	assert.equal(JSON.stringify(descriptor),before);
	assert.equal(forgetInertDateRangeRequestValue(descriptor),false);
	for(const value of [null,undefined,false,1,"synthetic",{}])assert.equal(forgetInertDateRangeRequestValue(value),false);
});
