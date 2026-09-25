import { LightningElement, api } from 'lwc';
import getContext from '@salesforce/apex/WiseCallSmsController.getContext';
import sendNow from '@salesforce/apex/WiseCallSmsController.sendNow';
import { CloseActionScreenEvent } from 'lightning/actions';
import { FlowAttributeChangeEvent } from 'lightning/flowSupport';

/**
 * Send SMS: record quick action, Flow screen component, or child component.
 * Public API for Flow / parents: recordId, phone, message (in), sent, result (out),
 * hideSendButton, and send() which returns a Promise resolving to the result text.
 */
export default class WiseCallSendSms extends LightningElement {
    _recordId;
    _phone;
    @api message = '';
    @api hideSendButton = false;
    @api sent = false;
    @api result = '';
    context;
    busy = false;
    notice = '';
    requestId;
    // Set automatically for record quick actions; never set on Flow screens.
    @api objectApiName;

    @api get recordId() { return this._recordId; }
    set recordId(value) {
        if (value && value !== this._recordId) { this._recordId = value; this.load(); }
    }

    @api get phone() { return this._phone; }
    set phone(value) { this._phone = value; }

    get isQuickAction() { return !!this.objectApiName; }

    get phoneOptions() { return (this.context?.phones || []).map(value => ({ label: value, value })); }
    get inputDisabled() { return this.busy || this.sent; }
    get sendDisabled() { return this.busy || this.sent || !this._phone || !(this.message || '').trim(); }
    get showSendButton() { return !this.hideSendButton; }
    get characterCount() {
        const length = (this.message || '').length;
        const segments = length === 0 ? 0 : Math.ceil(length / (length > 160 ? 153 : 160));
        return `${length}/1000 characters · ${segments} SMS`;
    }

    async load() {
        this.busy = true;
        try {
            this.context = await getContext({ recordId: this._recordId });
            if (!this._phone || !this.context.phones.includes(this._phone)) this._phone = this.context.phones[0];
            if (!this.context.phones.length) this.notice = 'This record has no phone number to text.';
            this.requestId = crypto.randomUUID();
        } catch (error) {
            this.notice = this.errorText(error);
        } finally {
            this.busy = false;
        }
    }

    changePhone(event) { this._phone = event.detail.value; this.notify('phone', this._phone); }
    changeMessage(event) { this.message = event.target.value; this.notify('message', this.message); }

    submit() { this.send().catch(() => {}); }

    /** Sends the SMS. Usable from a parent component or a Flow wrapper. */
    @api
    async send() {
        if (this.sendDisabled) throw new Error('Nothing to send.');
        this.busy = true;
        try {
            this.result = await sendNow({ recordId: this._recordId, phone: this._phone, message: this.message, requestId: this.requestId });
            this.sent = true;
            this.notice = this.result;
            this.notify('sent', true);
            this.notify('result', this.result);
            return this.result;
        } catch (error) {
            this.notice = this.errorText(error);
            this.notify('result', this.notice);
            throw error;
        } finally {
            this.busy = false;
        }
    }

    /** Lets a Flow block Next until the SMS has gone. */
    @api
    validate() {
        if (this.sent || this.hideSendButton) return { isValid: true };
        return { isValid: false, errorMessage: 'Send the SMS before continuing.' };
    }

    notify(name, value) {
        this.dispatchEvent(new FlowAttributeChangeEvent(name, value));
    }

    close() { this.dispatchEvent(new CloseActionScreenEvent()); }

    errorText(error) { return error?.body?.message || error?.message || 'The connection could not be completed.'; }
}
