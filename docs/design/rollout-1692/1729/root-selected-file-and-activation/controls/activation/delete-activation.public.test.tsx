// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Activity } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { deleteEmployeeDocumentAction } from '@/app/[locale]/(app)/personnel-files/actions';
import type { EmployeeDocumentView } from '@/lib/personnel-file/document-store';
import { DeleteDocumentDialog } from '@/components/personnel-file/delete-document-dialog';
vi.mock('@/app/[locale]/(app)/personnel-files/actions', () => ({ deleteEmployeeDocumentAction: vi.fn() }));
vi.mock('@tolgee/react', () => ({useTranslate: () => ({t: (_key: string, fallback: string, params?: Record<string, unknown>) => fallback.replace(/\{(\w+)\}/g, (match, key: string) => String(params?.[key] ?? match))})}));
afterEach(cleanup);
const document: EmployeeDocumentView = { id:'synthetic-document', employeeId:'synthetic-employee', title:'Synthetic qualification', category:'certificate',visibility:'shared',documentDate:'2026-01-15',payPeriod:null,expiryDate:null,fileName:'synthetic.pdf',mimeType:'application/pdf',sizeBytes:10,createdAt:'2026-01-15T12:00:00Z',absence:null,skill:null };
const drain = async () => { await act(async () => { await new Promise(done => setTimeout(done, 30)); }); };
function prepare(){vi.mocked(deleteEmployeeDocumentAction).mockReset().mockResolvedValue({success:false,error:'Synthetic refusal'});return {onOpenChange:vi.fn(),onDeleted:vi.fn()};}
it('control: a current public confirmation dispatches its exact document and reason',async()=>{const callbacks=prepare();render(<DeleteDocumentDialog document={document} {...callbacks}/>);fireEvent.change(screen.getByRole('textbox'),{target:{value:'Synthetic optional reason'}});fireEvent.click(screen.getByRole('button',{name:'Delete'}));await waitFor(()=>expect(deleteEmployeeDocumentAction).toHaveBeenCalledWith({documentId:'synthetic-document',reason:'Synthetic optional reason'}));});
it('does not dispatch an obsolete confirmation cleared before form validation completes',async()=>{const callbacks=prepare();const view=render(<DeleteDocumentDialog document={document} {...callbacks}/>);fireEvent.click(screen.getByRole('button',{name:'Delete'}));expect(deleteEmployeeDocumentAction).not.toHaveBeenCalled();view.rerender(<DeleteDocumentDialog document={null} {...callbacks}/>);await drain();expect(deleteEmployeeDocumentAction).not.toHaveBeenCalled();});
it('does not dispatch an obsolete confirmation after same-turn Activity retirement',async()=>{const callbacks=prepare();const view=render(<Activity mode='visible'><DeleteDocumentDialog document={document} {...callbacks}/></Activity>);fireEvent.click(screen.getByRole('button',{name:'Delete'}));expect(deleteEmployeeDocumentAction).not.toHaveBeenCalled();view.rerender(<Activity mode='hidden'><DeleteDocumentDialog document={document} {...callbacks}/></Activity>);view.rerender(<Activity mode='visible'><DeleteDocumentDialog document={document} {...callbacks}/></Activity>);await drain();expect(deleteEmployeeDocumentAction).not.toHaveBeenCalled();});
