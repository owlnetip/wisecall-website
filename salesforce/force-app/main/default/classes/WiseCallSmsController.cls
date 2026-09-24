public with sharing class WiseCallSmsController {
    public class Context {
        @AuraEnabled public String name;
        @AuraEnabled public String contactId;
        @AuraEnabled public List<String> phones;
        @AuraEnabled public String sender;
        @AuraEnabled public String recipientName;
        @AuraEnabled public String recipientId;
    }
    public class LookupResult {
        @AuraEnabled public String status;
        @AuraEnabled public Integer candidateCount;
        @AuraEnabled public Boolean currentRecordMatched;
    }
    @AuraEnabled
    public static Context getContext(Id recordId) {
        if (recordId == null) throw new AuraHandledException('Open a Contact, Lead or Person Account.');
        Context result = new Context();
        result.phones = new List<String>();
        SObject record;
        List<String> fields;
        if (recordId.getSObjectType() == Contact.SObjectType) {
            record = [SELECT Id, Name, Phone, MobilePhone, HomePhone, OtherPhone FROM Contact WHERE Id = :recordId WITH USER_MODE];
            result.contactId = String.valueOf(recordId);
            fields = new List<String>{'Phone','MobilePhone','HomePhone','OtherPhone'};
        } else if (recordId.getSObjectType() == Lead.SObjectType) {
            record = [SELECT Id, Name, Phone, MobilePhone FROM Lead WHERE Id = :recordId AND IsConverted = false WITH USER_MODE];
            result.contactId = String.valueOf(recordId);
            fields = new List<String>{'Phone','MobilePhone'};
        } else if (recordId.getSObjectType() == Account.SObjectType) {
            Account person = [SELECT Id, Name, Phone, IsPersonAccount, PersonContactId FROM Account WHERE Id = :recordId WITH USER_MODE];
            if (!person.IsPersonAccount || person.PersonContactId == null) throw new AuraHandledException('For a business Account, open the person’s Contact to send SMS.');
            List<Contact> visible = [SELECT Id FROM Contact WHERE Id = :person.PersonContactId WITH USER_MODE];
            if (visible.isEmpty()) throw new AuraHandledException('You cannot access the linked Contact.');
            record = person;
            result.contactId = String.valueOf(person.PersonContactId);
            fields = new List<String>{'Phone'};
        } else throw new AuraHandledException('This record type does not support SMS.');
        result.name = (String)record.get('Name');
        for (String field : fields) {
            String phone = (String)record.get(field);
            if (!String.isBlank(phone) && !result.phones.contains(phone)) result.phones.add(phone);
        }
        result.sender = System.Label.WiseCall_SMS_Sender;
        result.recipientName = UserInfo.getName();
        result.recipientId = UserInfo.getUserId();
        return result;
    }
    private static Context checkedContext(Id recordId, String phone) {
        Context context = getContext(recordId);
        if (!context.phones.contains(phone)) throw new AuraHandledException('Choose a phone number stored on this record.');
        return context;
    }
    @AuraEnabled
    public static LookupResult lookup(Id recordId, String phone) {
        Context context = checkedContext(recordId, phone);
        Map<String,Object> data = callPortal('GET', '?profile_id=' + EncodingUtil.urlEncode(System.Label.WiseCall_SMS_Profile_Id,'UTF-8') + '&to=' + EncodingUtil.urlEncode(phone,'UTF-8'), null, null);
        LookupResult result = new LookupResult();
        result.status = (String)data.get('status');
        result.currentRecordMatched = false;
        result.candidateCount = 0;
        if (data.get('record') instanceof Map<String,Object>) {
            Map<String,Object> matched = (Map<String,Object>)data.get('record');
            result.currentRecordMatched = context.contactId == (String)matched.get('id');
            result.candidateCount = 1;
        }
        if (data.get('candidates') instanceof List<Object>) {
            List<Object> candidates = (List<Object>)data.get('candidates');
            result.candidateCount = candidates.size();
            for (Object candidate : candidates) {
                if (context.contactId == (String)((Map<String,Object>)candidate).get('id')) result.currentRecordMatched = true;
            }
        }
        // Never reveal other records' names, phone numbers or owner emails.
        return result;
    }
    @AuraEnabled
    public static String send(Id recordId, String phone, String message, Boolean confirmed, String requestId) {
        if (confirmed != true) throw new AuraHandledException('Confirm the record and reply recipient first.');
        if (String.isBlank(message) || message.length() > 1000) throw new AuraHandledException('Enter a message of up to 1,000 characters.');
        if (String.isBlank(requestId) || !Pattern.matches('^[a-zA-Z0-9-]{16,80}$', requestId)) throw new AuraHandledException('Invalid send request. Reopen the action.');
        Context context = checkedContext(recordId,phone);
        Map<String,Object> payload = new Map<String,Object>{
            'profile_id' => System.Label.WiseCall_SMS_Profile_Id, 'from' => context.sender,
            'to' => phone, 'text' => message, 'confirm_record_id' => context.contactId,
            'confirm_reply_route' => new Map<String,Object>{'type'=>'user','recipient_id'=>UserInfo.getUserId()}
        };
        Map<String,Object> result = callPortal('POST','',payload,requestId);
        if (result.get('ok') != true) throw new AuraHandledException('SMS was not confirmed as sent. Check the record and routing before retrying.');
        return 'SMS accepted. Replies are assigned to ' + context.recipientName + '.';
    }
    private static Map<String,Object> callPortal(String method, String query, Map<String,Object> payload, String requestId) {
        HttpRequest request = new HttpRequest();
        request.setEndpoint('callout:WiseCall_SMS/api/integrations/salesforce/sms' + query);
        request.setMethod(method);
        request.setTimeout(20000);
        if (payload != null) {
            request.setHeader('Content-Type','application/json');
            request.setHeader('Idempotency-Key',UserInfo.getUserId() + ':' + requestId);
            request.setBody(JSON.serialize(payload));
        }
        HttpResponse response = new Http().send(request);
        Set<Integer> handledStatuses = new Set<Integer>{200,201,404,409,422};
        if (!handledStatuses.contains(response.getStatusCode())) throw new AuraHandledException('WiseCall connection unavailable. No automatic retry was made.');
        try { return (Map<String,Object>)JSON.deserializeUntyped(response.getBody()); }
        catch (Exception error) { throw new AuraHandledException('WiseCall returned an unexpected response.'); }
    }
}
