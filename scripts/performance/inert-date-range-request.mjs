/** Unwired syntax/shape parser. It supplies no source, request EOF or T authority. */
import {createHash} from "node:crypto";

export const inertDateRangeRequestLimits=Object.freeze({encodedBytes:16384,work:65536,depth:2,punctuation:32});
const values=new WeakMap(),fields=Object.freeze(["start","end","startDate","endDate","timezone"]);
const reasons=new Set(["invalid-input","byte-limit","shared-input","invalid-utf8","invalid-json","work-limit","depth-limit","punctuation-limit","duplicate-field","unsupported-field","unsupported-value","missing-field","trailing-data","unsupported-unicode","noncanonical-date","unsupported-protocol-string"]);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
/** The returned object is safe to serialize; its inert value is private, immutable RAM data. */
export function parseInertDateRangeRequest(bytes){
	let work=0,maxDepth=0,punctuation=0,bodySha256=null;
	const fail=reason=>{throw reason;};
	const facts=()=>({protocol:"inert-date-range-request-v1",sourceBound:false,requestEOFClaim:false,acceptanceClaim:"none",encodedBytes:Buffer.isBuffer(bytes)?bytes.length:null,bodySha256,work,maxDepth,punctuation});
	try{
		if(!Buffer.isBuffer(bytes))fail("invalid-input");
		if(bytes.length>inertDateRangeRequestLimits.encodedBytes)fail("byte-limit");
		if(typeof SharedArrayBuffer!=="undefined" && bytes.buffer instanceof SharedArrayBuffer)fail("shared-input");
		bodySha256=sha(bytes);let text;
		try{text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail("invalid-utf8");}
		let offset=0,depth=0;
		const charge=()=>{if(++work>inertDateRangeRequestLimits.work)fail("work-limit");};
		const take=()=>{charge();return text[offset++];};
		const space=()=>{while(offset<text.length && " \t\n\r".includes(text[offset]))take();};
		const consume=character=>{
			space();if(take()!==character)fail("invalid-json");
			if(++punctuation>inertDateRangeRequestLimits.punctuation)fail("punctuation-limit");
			if(character==="["||character==="{"){maxDepth=Math.max(maxDepth,++depth);if(depth>inertDateRangeRequestLimits.depth)fail("depth-limit");}
			if(character==="]"||character==="}")depth--;
		};
		const string=()=>{
			space();if(text[offset]!=='"')fail("unsupported-value");const start=offset;take();let closed=false;
			while(offset<text.length){const char=take();if(char==='"'){closed=true;break;}if(char.charCodeAt(0)<32)fail("invalid-json");
				if(char==="\\"){const escaped=take();if(escaped==="u"){for(let n=0;n<4;n++){const hex=take();if(typeof hex!=="string"||!/^[a-fA-F0-9]$/.test(hex))fail("invalid-json");}}else if(typeof escaped!=="string"||!'"\\/bfnrt'.includes(escaped))fail("invalid-json");}
			}
			if(!closed)fail("invalid-json");let value;try{value=JSON.parse(text.slice(start,offset));}catch{fail("invalid-json");}
			for(let n=0;n<value.length;n++){charge();const unit=value.charCodeAt(n);if(unit>=0xd800&&unit<=0xdbff){const low=value.charCodeAt(++n);charge();if(!(low>=0xdc00&&low<=0xdfff))fail("unsupported-unicode");}else if(unit>=0xdc00&&unit<=0xdfff)fail("unsupported-unicode");}
			return value;
		};
		consume("[");consume("{");const decoded=Object.create(null),seen=new Set();space();
		if(text[offset]!=="}")while(true){
			const key=string();if(seen.has(key))fail("duplicate-field");if(!fields.includes(key))fail("unsupported-field");seen.add(key);consume(":");decoded[key]=string();space();
			if(text[offset]!==",")break;consume(",");
		}
		consume("}");consume("]");space();if(offset!==text.length)fail("trailing-data");if(fields.some(key=>!seen.has(key)))fail("missing-field");
		const date=wire=>{
			if(!wire.startsWith("$D"))fail("noncanonical-date");const iso=wire.slice(2);
			if(!/^(?:\d{4}|[+-]\d{6})-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(iso)||!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString()!==iso)fail("noncanonical-date");
			return Object.freeze({kind:"react-date",iso});
		};
		const literal=wire=>{if(wire.startsWith("$")&&!wire.startsWith("$$"))fail("unsupported-protocol-string");return Object.freeze({kind:"literal-string",text:wire.startsWith("$$")?wire.slice(1):wire});};
		const value=Object.freeze({kind:"date-range",start:date(decoded.start),end:date(decoded.end),startDate:literal(decoded.startDate),endDate:literal(decoded.endDate),timezone:literal(decoded.timezone)});
		const descriptor=Object.freeze({...facts(),known:true,duplicateKeys:"absent",inputConsumed:true,fieldCount:5,valueDescriptorSha256:sha(JSON.stringify(value))});
		values.set(descriptor,value);return descriptor;
	}catch(error){return Object.freeze({...facts(),known:false,reason:typeof error==="string"&&reasons.has(error)?error:"parse-unavailable",duplicateKeys:"unproved"});}
}
/** RAM-only typed data, not a temporary-map/source/request capability. Copied facts cannot retrieve it. */
export function readInertDateRangeRequestValue(descriptor){
	return descriptor!==null&&(typeof descriptor==="object"||typeof descriptor==="function")?values.get(descriptor)??null:null;
}
