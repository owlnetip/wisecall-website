@IsTest
private class WiseCallSmsTest {

    private class PortalMock implements HttpCalloutMock {
        Integer status;
        String body;
        List<Map<String, Object>> sent = new List<Map<String, Object>>();
        PortalMock(Integer status, String body) { this.status = status; this.body = body; }
        public HttpResponse respond(HttpRequest request) {
            System.assertEquals('callout:WiseCall_SMS/api/integrations/salesforce/sms/send', request.getEndpoint());
            System.assertEquals('POST', request.getMethod());
            System.assertNotEquals(null, request.getHeader('Idempotency-Key'));
            sent.add((Map<String, Object>) JSON.deserializeUntyped(request.getBody()));
            HttpResponse response = new HttpResponse();
            response.setStatusCode(status);
            response.setBody(body);
            return response;
        }
    }

    private static Id personAccountRecordTypeId() {
        return [SELECT Id FROM RecordType WHERE SobjectType = 'Account' AND IsPersonType = true AND IsActive = true LIMIT 1].Id;
    }

    private static Lead newLead(String phone) {
        Lead lead = new Lead(FirstName = 'Wise', LastName = 'Call Test', MobilePhone = phone, Phone = phone);
        insert lead;
        return lead;
    }

    private static Account newPersonAccount(String phone) {
        Account account = new Account(RecordTypeId = personAccountRecordTypeId(), FirstName = 'Wise', LastName = 'Person Test');
        account.put('PersonMobilePhone', phone);
        insert account;
        return account;
    }

    @IsTest
    static void sendPostsRecordPhoneAndContent() {
        Lead lead = newLead('07700900461');
        PortalMock mock = new PortalMock(200, '{"ok":true,"message_id":"m-1"}');
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        WiseCallSms.Result result = WiseCallSms.send(lead.Id, '07700900461', 'Hi Wise, please return your agreement.');
        Test.stopTest();
        System.assert(result.success, result.error);
        System.assertEquals('m-1', result.messageId);
        System.assertEquals(String.valueOf(lead.Id), mock.sent[0].get('record_id'));
        System.assertEquals('07700900461', mock.sent[0].get('phone'));
        System.assertEquals('Hi Wise, please return your agreement.', mock.sent[0].get('text'));
        System.assertEquals(System.Label.WiseCall_SMS_Sender, mock.sent[0].get('from'));
    }

    @IsTest
    static void sendReportsFailuresAndValidates() {
        Lead lead = newLead('07700900462');
        Test.setMock(HttpCalloutMock.class, new PortalMock(502, '{"ok":false,"error":"Vonage rejected the number"}'));
        Test.startTest();
        WiseCallSms.Result failed = WiseCallSms.send(lead.Id, '07700900462', 'Hello');
        Test.stopTest();
        System.assertEquals(false, failed.success);
        System.assertEquals('Vonage rejected the number', failed.error);
        System.assertNotEquals(null, WiseCallSms.validate(null, '07700900462', 'x'));
        System.assertNotEquals(null, WiseCallSms.validate(lead.Id, '123', 'x'));
        System.assertNotEquals(null, WiseCallSms.validate(lead.Id, '07700900462', ' '));
        System.assertNotEquals(null, WiseCallSms.validate(lead.Id, '07700900462', 'x'.repeat(1001)));
        System.assertNotEquals(null, WiseCallSms.validate(UserInfo.getUserId(), '07700900462', 'x'));
        System.assertEquals(false, WiseCallSms.send(null, '07700900462', 'x').success);
    }

    @IsTest
    static void flowActionQueuesSendAndLogsOutboundTask() {
        Lead lead = newLead('07700900463');
        Test.setMock(HttpCalloutMock.class, new PortalMock(200, '{"ok":true,"message_id":"m-2"}'));
        WiseCallSms.SendRequest request = new WiseCallSms.SendRequest();
        request.recordId = lead.Id;
        request.phone = '07700900463';
        request.content = 'Your viewing is confirmed.';
        Test.startTest();
        WiseCallSms.sendFromFlow(new List<WiseCallSms.SendRequest>{ request });
        Test.stopTest();
        Task task = [SELECT Subject, Type, Status, WhoId, Description FROM Task WHERE WhoId = :lead.Id LIMIT 1];
        System.assertEquals('SMS', task.Type);
        System.assertEquals('Completed', task.Status);
        System.assertEquals('SMS sent: Your viewing is confirmed.', task.Subject);
        System.assertEquals('Your viewing is confirmed.\n\nWiseCall message id: m-2', task.Description);
    }

    @IsTest
    static void buttonSendsFromTheRecordAndLogs() {
        Account person = newPersonAccount('07700900464');
        Test.setMock(HttpCalloutMock.class, new PortalMock(200, '{"ok":true,"message_id":"m-3"}'));
        WiseCallSmsController.Context context = WiseCallSmsController.getContext(person.Id);
        System.assert(context.phones.contains('07700900464'));
        Test.startTest();
        String message = WiseCallSmsController.sendNow(person.Id, '07700900464', 'Hello from the record', 'req-1');
        Test.stopTest();
        System.assert(message.startsWith('SMS sent'));
        Id personContactId = [SELECT PersonContactId FROM Account WHERE Id = :person.Id].PersonContactId;
        System.assertEquals(1, [SELECT COUNT() FROM Task WHERE WhoId = :personContactId AND Type = 'SMS']);
        try {
            WiseCallSmsController.sendNow(person.Id, '07000000000', 'x', null);
            System.assert(false, 'A number not on the record must be rejected');
        } catch (AuraHandledException expected) {}
        Lead lead = newLead('07700900465');
        System.assert(WiseCallSmsController.getContext(lead.Id).phones.contains('07700900465'));
    }

    @IsTest
    static void replyWithRecordIdLogsOnThatRecord() {
        Lead lead = newLead('07700900466');
        WiseCallSmsReplyService.Reply reply = new WiseCallSmsReplyService.Reply();
        reply.phone = '+447700900466';
        reply.content = 'Yes Thursday works';
        reply.recordId = lead.Id;
        reply.messageId = 'msg-1';
        WiseCallSmsReplyService.Outcome outcome = WiseCallSmsReplyService.handle(reply);
        System.assertEquals('record', outcome.matchType);
        System.assertEquals(lead.Id, outcome.recordId);
        Task task = [SELECT Subject, Type, Description FROM Task WHERE Id = :outcome.taskId];
        System.assertEquals('SMS received: Yes Thursday works', task.Subject);
        System.assertEquals('SMS', task.Type);
        System.assert(task.Description.contains('msg-1'));
    }

    @IsTest
    static void replyForConvertedLeadFollowsTheConvertedAccount() {
        Lead lead = newLead('07700900467');
        Database.LeadConvert convert = new Database.LeadConvert();
        convert.setLeadId(lead.Id);
        convert.setConvertedStatus([SELECT MasterLabel FROM LeadStatus WHERE IsConverted = true LIMIT 1].MasterLabel);
        convert.setDoNotCreateOpportunity(true);
        Database.LeadConvertResult converted = Database.convertLead(convert);
        WiseCallSmsReplyService.Reply reply = new WiseCallSmsReplyService.Reply();
        reply.phone = '07700900467';
        reply.content = 'Signed and sent back';
        reply.recordId = lead.Id;
        WiseCallSmsReplyService.Outcome outcome = WiseCallSmsReplyService.handle(reply);
        System.assertEquals('converted', outcome.matchType);
        System.assertEquals(converted.getAccountId(), outcome.recordId);
    }

    @IsTest
    static void replyWithoutRecordIdMatchesPersonAccountBeforeLead() {
        Account person = newPersonAccount('07700900468');
        Lead lead = newLead('07700900468');
        Test.setFixedSearchResults(new List<Id>{ person.Id, lead.Id });
        WiseCallSmsReplyService.Reply reply = new WiseCallSmsReplyService.Reply();
        reply.phone = '+447700900468';
        reply.content = 'Who is this?';
        WiseCallSmsReplyService.Outcome outcome = WiseCallSmsReplyService.handle(reply);
        System.assertEquals('person_account', outcome.matchType);
        System.assertEquals(person.Id, outcome.recordId);
    }

    @IsTest
    static void replyWithoutRecordIdFallsBackToLead() {
        Lead lead = newLead('07700900469');
        Test.setFixedSearchResults(new List<Id>{ lead.Id });
        WiseCallSmsReplyService.Reply reply = new WiseCallSmsReplyService.Reply();
        reply.phone = '07700 900469';
        reply.content = 'Call me back';
        WiseCallSmsReplyService.Outcome outcome = WiseCallSmsReplyService.handle(reply);
        System.assertEquals('lead', outcome.matchType);
        System.assertEquals(lead.Id, outcome.recordId);
    }

    @IsTest
    static void unmatchedReplyCreatesNoTaskAndTriesFallbackEmail() {
        Test.setFixedSearchResults(new List<Id>());
        WiseCallSmsReplyService.Reply reply = new WiseCallSmsReplyService.Reply();
        reply.phone = '07700900470';
        reply.content = 'Hello?';
        Integer before = [SELECT COUNT() FROM Task];
        WiseCallSmsReplyService.Outcome outcome = WiseCallSmsReplyService.handle(reply);
        System.assertEquals('none', outcome.matchType);
        System.assertEquals(null, outcome.taskId);
        System.assertEquals(before, [SELECT COUNT() FROM Task]);
        WiseCallSmsReplyService.Reply empty = new WiseCallSmsReplyService.Reply();
        System.assertEquals(false, WiseCallSmsReplyService.handle(empty).ok);
    }

    @IsTest
    static void restEndpointReturnsTheOutcome() {
        Lead lead = newLead('07700900471');
        RestRequest request = new RestRequest();
        request.requestURI = '/services/apexrest/wisecall/sms/reply';
        request.httpMethod = 'POST';
        request.requestBody = Blob.valueOf(JSON.serialize(new Map<String, Object>{
            'phone' => '07700900471', 'content' => 'Thanks', 'record_id' => String.valueOf(lead.Id), 'message_id' => 'msg-9'
        }));
        RestContext.request = request;
        RestContext.response = new RestResponse();
        WiseCallSmsReplyResource.receive();
        System.assertEquals(200, RestContext.response.statusCode);
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString());
        System.assertEquals('record', body.get('match_type'));
        System.assertNotEquals(null, body.get('task_id'));

        request.requestBody = Blob.valueOf('not json');
        WiseCallSmsReplyResource.receive();
        System.assertEquals(500, RestContext.response.statusCode);
    }

    @IsTest
    static void deliveryReceiptMarksTheOutboundTask() {
        Lead lead = newLead('07700900472');
        Id taskId = WiseCallSms.logTask(lead.Id, 'Please sign the agreement', 'Outbound', UserInfo.getUserId(), WiseCallSms.messageIdNote('m-100'));
        WiseCallSmsStatusService.Result delivered = WiseCallSmsStatusService.apply(lead.Id, 'm-100', 'delivered', null, '2026-09-25T14:25:31Z');
        System.assertEquals(taskId, delivered.taskId);
        Task task = [SELECT Subject, Description FROM Task WHERE Id = :taskId];
        System.assert(task.Description.contains('Delivered to handset 25/09/2026 15:25'), task.Description);
        System.assertEquals('SMS sent: Please sign the agreement', task.Subject);
        // A repeat receipt does not add the line twice.
        WiseCallSmsStatusService.apply(lead.Id, 'm-100', 'delivered', null, '2026-09-25T14:25:31Z');
        System.assertEquals(1, [SELECT Description FROM Task WHERE Id = :taskId].Description.countMatches('Delivered to handset'));
    }

    @IsTest
    static void failedReceiptRenamesTheTask() {
        Account person = newPersonAccount('07700900473');
        Id taskId = WiseCallSms.logTask(person.Id, 'Your viewing is tomorrow', 'Outbound', UserInfo.getUserId(), WiseCallSms.messageIdNote('m-101'));
        WiseCallSmsStatusService.Result failed = WiseCallSmsStatusService.apply(person.Id, 'm-101', 'undeliverable', 'Invalid number', null);
        System.assertEquals(false, failed.delivered);
        Task task = [SELECT Subject, Description FROM Task WHERE Id = :taskId];
        System.assertEquals('SMS not delivered: Your viewing is tomorrow', task.Subject);
        System.assert(task.Description.contains('NOT delivered (undeliverable: Invalid number)'));
    }

    @IsTest
    static void receiptForUnknownMessageIsANoOp() {
        Lead lead = newLead('07700900474');
        WiseCallSmsStatusService.Result result = WiseCallSmsStatusService.apply(lead.Id, 'unknown', 'delivered', null, null);
        System.assert(result.ok);
        System.assertEquals(null, result.taskId);
        System.assertEquals(false, WiseCallSmsStatusService.apply(lead.Id, null, 'delivered', null, null).ok);
    }

    @IsTest
    static void restEndpointAcceptsDeliveryReceipts() {
        Lead lead = newLead('07700900475');
        Id taskId = WiseCallSms.logTask(lead.Id, 'Hello', 'Outbound', UserInfo.getUserId(), WiseCallSms.messageIdNote('m-102'));
        RestRequest request = new RestRequest();
        request.requestURI = '/services/apexrest/wisecall/sms/reply';
        request.httpMethod = 'POST';
        request.requestBody = Blob.valueOf(JSON.serialize(new Map<String, Object>{
            'type' => 'status', 'record_id' => String.valueOf(lead.Id), 'message_id' => 'm-102', 'status' => 'delivered'
        }));
        RestContext.request = request;
        RestContext.response = new RestResponse();
        WiseCallSmsReplyResource.receive();
        System.assertEquals(200, RestContext.response.statusCode);
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString());
        System.assertEquals(String.valueOf(taskId), body.get('task_id'));
    }

    @IsTest
    static void helpers() {
        System.assertEquals('447700900123', WiseCallSmsReplyService.normalise('07700 900123'));
        System.assertEquals('447700900123', WiseCallSmsReplyService.normalise('+44 7700 900123'));
        System.assertEquals('447700900123', WiseCallSmsReplyService.normalise('0044 7700 900123'));
        System.assertEquals('SMS received: a b', WiseCallSms.subjectFor('Inbound', 'a\nb'));
        System.assert(WiseCallSms.subjectFor('Outbound', 'x'.repeat(200)).length() <= 90);
        System.assertEquals(null, WiseCallSmsReplyService.fromRecordId('not-an-id'));
    }
}
