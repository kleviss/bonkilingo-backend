# Supabase Email Template Customization Guide

This guide shows you how to customize Supabase authentication emails to match your Bonkilingo branding.

## Quick Start

1. **Open Supabase Dashboard** → Your Project → Authentication → Email Templates
2. **Choose a template** (e.g., "Confirm signup")
3. **Copy HTML** from `email-templates/confirm-signup.html`
4. **Paste into Supabase** template body
5. **Update subject** to: `Welcome to Bonkilingo! Confirm your email`
6. **Save** and test!

## Setup Instructions

### 1. Access Supabase Dashboard

1. Go to your [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Navigate to **Authentication** → **Email Templates**

### 2. Available Email Templates

Supabase provides templates for:
- **Confirm signup** - Email verification when users sign up
- **Magic Link** - Passwordless login emails
- **Change Email Address** - Email change confirmation
- **Reset Password** - Password reset emails
- **Invite user** - Team invitation emails

### 3. Customizing Templates

Each template supports:
- **Subject** - Email subject line
- **Body** - HTML email content
- **Variables** - Dynamic content like `{{ .ConfirmationURL }}`, `{{ .Email }}`, etc.

## Email Template Variables

### Available Variables:
- `{{ .ConfirmationURL }}` - Confirmation/verification link
- `{{ .Email }}` - User's email address
- `{{ .Token }}` - Verification token (for custom flows)
- `{{ .TokenHash }}` - Hashed token
- `{{ .SiteURL }}` - Your app's URL
- `{{ .RedirectTo }}` - Redirect URL after confirmation

## Recommended Email Templates

### 1. Confirm Signup Template

**Subject:**
```
Welcome to Bonkilingo! Confirm your email
```

**Body:** (See `email-templates/confirm-signup.html`)

### 2. Magic Link Template

**Subject:**
```
Your Bonkilingo login link
```

**Body:** (See `email-templates/magic-link.html`)

### 3. Change Email Address Template

**Subject:**
```
Confirm your new email address for Bonkilingo
```

**Body:** (See `email-templates/change-email.html`)

### 4. Reset Password Template

**Subject:**
```
Reset your Bonkilingo password
```

**Body:** (See `email-templates/reset-password.html`)

## Configuration Steps

1. **Copy the HTML templates** from `email-templates/` folder
2. **Go to Supabase Dashboard** → Authentication → Email Templates
3. **Select the template** you want to customize
4. **Paste the HTML** into the body field
5. **Update the subject line** with the recommended subject
6. **Save** the template
7. **Test** by signing up a new user

## Custom SMTP (Optional)

For better deliverability and branding:

1. Go to **Settings** → **Auth** → **SMTP Settings**
2. Configure your SMTP provider (SendGrid, Mailgun, AWS SES, etc.)
3. Set **From email** to: `noreply@bonkilingo.app` (or your domain)
4. Set **From name** to: `Bonkilingo`

## Testing

After updating templates:

1. Use a test email address
2. Sign up a new account
3. Check the email inbox
4. Verify the styling and links work correctly
5. Test on different email clients (Gmail, Outlook, Apple Mail)

## Best Practices

1. **Keep it simple** - Avoid complex HTML that might break in email clients
2. **Mobile-friendly** - Test on mobile devices
3. **Clear CTAs** - Make buttons/links obvious
4. **Brand consistency** - Use your app colors and logo
5. **Security** - Never include sensitive data in emails
6. **Accessibility** - Use proper alt text for images

## Troubleshooting

- **Emails not sending**: Check SMTP configuration or use Supabase default
- **Styling broken**: Test in multiple email clients, use inline CSS
- **Links not working**: Verify `{{ .ConfirmationURL }}` variable is correct
- **Spam folder**: Configure SPF/DKIM records for custom domain

