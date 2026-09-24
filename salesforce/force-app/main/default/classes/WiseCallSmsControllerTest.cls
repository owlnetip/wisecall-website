@IsTest
private class WiseCallSmsControllerTest {
    private class PortalMock implements HttpCalloutMock {
        Id contactId;
        PortalMock(Id value) { contactId = value; }
        public HttpResponse respond(HttpRequest request) {
            System.assert(request.getEndpoint().startsWith('callout:WiseCall_SMS/api/integrations/salesforce/sms'));
            HttpResponse response = new HttpResponse();
            response.setHeader('Content-Type','application/json');
            if (request.getMethod() == 'GET') {
                response.setStatusCode(409);
                response.setBody(JSON.serialize(new Map<String,Object>{'status'=>'confirm_reply_route','record'=>new Map<String,Object>{'id'=>String.valueOf(contactId)}}));
            } else {
                Map<String,Object> body = (Map<String,Object>)JSON.deserializeUntyped(request.getBody());
                System.assertEquals('447451273985',body.get('from'));
                System.assertEquals('Exact test message',body.get('text'));
                System.assertEquals(String.valueOf(contactId),body.get('confirm_record_id'));
                Map<String,Object> route = (Map<String,Object>)body.get('confirm_reply_route');
                System.assertEquals('user',route.get('type'));
                System.assertEquals(UserInfo.getUserId(),route.get('recipient_id'));
                System.assertNotEquals(null,request.getHeader('Idempotency-Key'));
                response.setStatusCode(200);
                response.setBody('{"ok":true,"status":"sent"}');
            }
            return response;
        }
    }
    @TestSetup static void records() {
        insert new Contact(LastName='WiseCall Test',Phone='07825395792');
    }
    @IsTest static void lookupAndExplicitSend() {
        Contact person = [SELECT Id FROM Contact LIMIT 1];
        Test.setMock(HttpCalloutMock.class,new PortalMock(person.Id));
        Test.startTest();
        WiseCallSmsController.Context context = WiseCallSmsController.getContext(person.Id);
        System.assertEquals(UserInfo.getUserId(),context.recipientId);
        WiseCallSmsController.LookupResult result = WiseCallSmsController.lookup(person.Id,'07825395792');
        System.assertEquals(true,result.currentRecordMatched);
        System.assertEquals(1,result.candidateCount);
        System.assert(WiseCallSmsController.send(person.Id,'07825395792','Exact test message',true,'12345678-1234-1234-1234-123456789abc').startsWith('SMS accepted.'));
        Test.stopTest();
    }
    @IsTest static void rejectsUnconfirmedAndUnstoredNumber() {
        Contact person = [SELECT Id FROM Contact LIMIT 1];
        try { WiseCallSmsController.send(person.Id,'07825395792','Test',false,'12345678-1234-1234-1234-123456789abc'); System.assert(false,'Must require confirmation'); }
        catch(AuraHandledException expected) {}
        try { WiseCallSmsController.lookup(person.Id,'07700900999'); System.assert(false,'Must reject another number'); }
        catch(AuraHandledException expected) {}
    }
}
