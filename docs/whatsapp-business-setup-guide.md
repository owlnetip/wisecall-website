# WiseCall WhatsApp Business Setup Guide

Use this guide when setting up WhatsApp for WiseCall.

WiseCall can reply to WhatsApp messages using the same AI agent that handles calls, email and live chat. To make this work, your WhatsApp number must be connected to a WhatsApp Business Account through Meta and our messaging provider.

## Recommended Setup

For most customers, the simplest option is:

1. WiseCall provides a new WhatsApp-ready number.
2. You connect that number to your Meta Business Portfolio.
3. WiseCall connects the number to your AI agent.

This avoids moving an existing WhatsApp number and is usually faster.

## Before You Start

You will need:

- Access to your Facebook account.
- Admin access to your Meta Business Portfolio.
- Your business legal name and address.
- Your business website.
- A phone number that can receive an SMS or voice verification code.
- Two-factor authentication enabled on your Facebook account if Meta asks for it.

If you are using a WiseCall-provided number, we will give you the number before you begin.

## Important Rules

- Do not create a WhatsApp Business Account manually in Meta Business Settings unless WiseCall asks you to.
- Create the WhatsApp Business Account during the Twilio or Vonage setup flow.
- A WhatsApp number can only be connected to one provider at a time.
- If your number is already used in the WhatsApp or WhatsApp Business mobile app, it may need to be removed from that app before it can be connected to the WhatsApp Business Platform.
- Meta may review your business and display name before allowing full production sending.

## Step 1: Check Meta Business Access

Go to Meta Business Settings:

https://business.facebook.com/settings

Check:

- You are in the correct business portfolio.
- You have full admin access.
- Your business name, address and website are correct.
- There are no outstanding issues in Business Support Home.

Business Support Home:

https://business.facebook.com/business-support-home/

If you see a business restriction, request a review before continuing.

## Step 2: Start the WhatsApp Setup Flow

WiseCall will send you a setup link or direct you to the provider setup screen.

During setup:

1. Log in with Facebook.
2. Select your Meta Business Portfolio.
3. Create a new WhatsApp Business Account if asked.
4. Enter your WhatsApp Business display name.
5. Select your business category.
6. Add the phone number.
7. Verify the number by SMS or voice call.

Use your real business name for the display name. Example:

```text
Owlnet IP Ltd
```

Avoid generic names such as:

```text
Support
Customer Service
AI Assistant
```

## Step 3: Verify the Phone Number

Meta will send a code by SMS or voice call.

If using a WiseCall-provided virtual number:

- The SMS code may appear in the provider's SMS logs, not on a mobile phone.
- If SMS does not arrive, try voice verification.
- Do not request codes repeatedly. Wait a few minutes between attempts.

If using your own mobile number:

- Make sure the SIM can receive SMS or calls.
- Enter the code exactly as shown.

## Step 4: Wait for Provider Connection

After verification, Meta may show a setup checklist.

Common statuses:

- Account connected to provider: completed.
- Connecting phone number: usually takes a few minutes.
- Send first message: available once the number is connected.
- Verify your business: may be required for higher limits or full approval.

If the phone number status does not update after several minutes, refresh the page.

## Step 5: Send WiseCall the Details

When setup is complete, send WiseCall:

- WhatsApp number.
- Business name.
- Meta Business Portfolio name.
- Provider used, for example Twilio or Vonage.
- A screenshot of the completed setup page.

WiseCall will then connect the number to your AI agent.

## What Customers Should Not Do

Do not:

- Create multiple WhatsApp Business Accounts unless asked.
- Use the same number in Twilio and Vonage at the same time.
- Delete a WhatsApp Business Account during setup.
- Connect an existing live WhatsApp number without checking migration requirements.
- Keep clicking resend verification code repeatedly.

## Troubleshooting

### My Business Portfolio Is Greyed Out

This usually means Meta has restricted the business, the account is not eligible, or your user does not have enough permission.

Check:

- Business Support Home.
- Account Quality.
- Business Settings > Users > People.
- Security Centre.

If there is a restriction, request a review.

### It Says My Business Is Not Eligible

This is a Meta issue, not a WiseCall, Twilio or Vonage issue.

Go to:

https://business.facebook.com/business-support-home/

Find the restriction and request a review. Wait for Meta to reinstate access before trying again.

### I Did Not Receive the SMS Code

If using a virtual number, check the provider's inbound SMS logs.

For Vonage, check SMS logs for inbound messages to the number.

If no SMS arrives:

1. Wait a few minutes.
2. Try resend once.
3. Try voice verification.
4. Check the number was entered in the correct format.

UK number format example:

```text
+447451277744
```

If the form separates country and number, use:

```text
Country: United Kingdom
Number: 7451277744
```

### It Says Additional Verification Required

Meta may review your business and display name. This can take from minutes to a few business days.

During review, you may have limited test messaging.

### I Already Use This Number on WhatsApp

If the number is already used in the WhatsApp mobile app or WhatsApp Business app, it may not be available for the WhatsApp Business Platform until removed from the app.

Speak to WiseCall before moving an existing live customer number.

### I See Developer Apps Called WiseCall

Meta Developer Apps are not the same as WhatsApp Business Accounts.

Do not create or delete developer apps during WhatsApp setup unless WiseCall asks you to.

## Bring Your Own Number

If you want to connect an existing WhatsApp number:

1. Tell WiseCall the number first.
2. Confirm whether it is currently used in WhatsApp, WhatsApp Business app, Twilio, Vonage or another provider.
3. Wait for WiseCall to confirm the migration route.

Moving an existing number can interrupt WhatsApp service if done incorrectly.

## Internal WiseCall Checklist

After the customer completes setup:

1. Confirm provider: Twilio or Vonage.
2. Confirm WhatsApp sender number in E.164 format.
3. Confirm target WiseCall profile or customer account.
4. Configure provider inbound webhook.
5. Map sender number to the WiseCall profile in Supabase.
6. Send inbound test message.
7. Confirm AI reply is delivered.
8. Record setup notes in the customer account.

Twilio inbound webhook:

```text
https://zgzzpwaqqftmugzpccpm.supabase.co/functions/v1/wisecall-whatsapp-inbound
```

Vonage inbound webhook:

```text
To be configured after Vonage payload is confirmed.
```

## Customer Email Template

Subject: Set up WhatsApp for WiseCall

Hi,

To connect WhatsApp to your WiseCall AI agent, please follow this setup guide:

1. Make sure you can access your Meta Business Portfolio as an admin.
2. Check Business Support Home for any restrictions.
3. Start the WhatsApp setup link we send you.
4. Select your business portfolio.
5. Create a new WhatsApp Business Account during the setup flow.
6. Verify the phone number by SMS or voice call.
7. Send us a screenshot once the number is connected.

If the business portfolio is greyed out or says it is not eligible, go to Business Support Home and request a review from Meta.

Once the number is connected, WiseCall will link it to your AI agent and run a test message.

## Official References

- Twilio WhatsApp Self Sign-up: https://www.twilio.com/docs/whatsapp/self-sign-up
- Meta Business Support Home: https://business.facebook.com/business-support-home/
- Meta WhatsApp Business Platform docs: https://developers.facebook.com/docs/whatsapp/
- Vonage Messages API docs: https://developer.vonage.com/en/messages/overview
