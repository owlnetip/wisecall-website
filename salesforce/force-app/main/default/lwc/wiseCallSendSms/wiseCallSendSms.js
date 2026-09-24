import { LightningElement, api } from 'lwc';
import getContext from '@salesforce/apex/WiseCallSmsController.getContext';
import lookup from '@salesforce/apex/WiseCallSmsController.lookup';
import send from '@salesforce/apex/WiseCallSmsController.send';
import { CloseActionScreenEvent } from 'lightning/actions';

export default class WiseCallSendSms extends LightningElement {
    _recordId; context; phone; message = ''; result; confirmed = false;
    busy = false; notice = ''; requestId; sent = false; attempted = false;
    @api get recordId() { return this._recordId; }
    set recordId(value) { if (value && value !== this._recordId) { this._recordId = value; this.load(); } }
    get phoneOptions() { return (this.context?.phones || []).map(value => ({label:value,value})); }
    get confirmationLabel() { return `Use ${this.context?.name || 'this record'} and assign replies to ${this.context?.recipientName || 'me'} (${this.context?.recipientId || ''}).`; }
    get sendDisabled() { return this.busy || this.sent || this.attempted || !this.confirmed || !this.result?.currentRecordMatched || !this.message.trim(); }
    get inputDisabled() { return this.busy || this.attempted; }
    async load() {
        this.busy = true;
        try { this.context = await getContext({recordId:this._recordId}); this.phone = this.context.phones[0]; this.requestId = crypto.randomUUID(); }
        catch(error) { this.notice = this.errorText(error); }
        finally { this.busy = false; }
    }
    changePhone(event) { this.phone = event.detail.value; this.result = null; this.confirmed = false; }
    changeMessage(event) { this.message = event.target.value; }
    confirm(event) { this.confirmed = event.target.checked; }
    async check() {
        this.busy = true; this.confirmed = false; this.result = null;
        try {
            this.result = await lookup({recordId:this._recordId,phone:this.phone});
            this.notice = this.result.currentRecordMatched
                ? `${this.result.candidateCount} matching record(s). Confirm this record and the reply recipient below.`
                : 'This record was not matched. Nothing will be sent. Check its phone details.';
        } catch(error) { this.notice = this.errorText(error); }
        finally { this.busy = false; }
    }
    async submit() {
        if (this.sendDisabled) return;
        this.busy = true; this.attempted = true;
        try { this.notice = await send({recordId:this._recordId,phone:this.phone,message:this.message,confirmed:this.confirmed,requestId:this.requestId}); this.sent = true; }
        catch(error) { this.notice = `${this.errorText(error)} Check delivery before starting another send; do not resend an uncertain message.`; }
        finally { this.busy = false; }
    }
    close() { this.dispatchEvent(new CloseActionScreenEvent()); }
    errorText(error) { return error?.body?.message || 'The connection could not be completed.'; }
}
