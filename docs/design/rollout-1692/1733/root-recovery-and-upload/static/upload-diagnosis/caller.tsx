import { useState } from "react";
import { createRoot } from "react-dom/client";
import { usePayslipBatchUpload } from "@/components/personnel-file/use-payslip-batch-upload";

const onStaged = () => {};
function Caller({ batchId }: { batchId: string }) {
  const upload = usePayslipBatchUpload({ batchId, onStaged });
  return <section>
    <h1>Payslip upload transport probe</h1>
    <p aria-label="Current batch">{batchId}</p>
    <label>PDF<input type="file" accept="application/pdf" onChange={event => {
      upload.addFiles(Array.from(event.currentTarget.files ?? []));
    }}/></label>
    <output aria-label="Staged files">{upload.progress.staged}</output>
    <output aria-label="Failed files">{upload.progress.failed.length}</output>
    <p role="status">{upload.progress.failed.map(file => file.error).join("; ")}</p>
  </section>;
}
function Probe() {
  const [batch, setBatch] = useState(1);
  const batchId = "probe-batch-" + batch;
  return <>
    <button type="button" onClick={() => setBatch(value => value + 1)}>Next batch</button>
    <Caller key={batchId} batchId={batchId}/>
  </>;
}
const element = document.getElementById("root");
if (!element) throw new Error("Probe root missing");
createRoot(element).render(<Probe/>);
