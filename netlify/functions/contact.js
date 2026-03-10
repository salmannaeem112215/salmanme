const nodemailer = require('nodemailer');

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getConfig() {
    const encryption = (process.env.CONTACT_SMTP_ENCRYPTION || process.env.SMTP_ENCRYPTION || 'tls').toLowerCase();

    return {
        host: process.env.CONTACT_SMTP_HOST || process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.CONTACT_SMTP_PORT || process.env.SMTP_PORT || 587),
        secure: encryption === 'ssl',
        user: process.env.CONTACT_SMTP_USER || process.env.EMAIL_USER || process.env.EMAIL_USERNAME || '',
        pass: process.env.CONTACT_SMTP_APP_PASSWORD || process.env.EMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || '',
        toEmail: process.env.CONTACT_TO_EMAIL || process.env.CONTACT_SMTP_USER || process.env.EMAIL_USER || '',
        fromEmail: process.env.CONTACT_FROM_EMAIL || process.env.CONTACT_SMTP_USER || process.env.EMAIL_USER || '',
        fromName: process.env.CONTACT_FROM_NAME || 'Website Contact Form',
        subjectPrefix: process.env.CONTACT_SUBJECT_PREFIX || 'New Contact Message',
        debug: String(process.env.CONTACT_SMTP_DEBUG || 'false').toLowerCase() === 'true',
    };
}

function parseBody(event) {
    const raw = event.body || '';

    if (!raw) {
        return {};
    }

    const contentType = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();

    if (contentType.includes('application/json')) {
        try {
            return JSON.parse(raw);
        } catch (error) {
            return {};
        }
    }

    const params = new URLSearchParams(raw);
    return {
        name: params.get('name') || '',
        email: params.get('email') || '',
        subject: params.get('subject') || '',
        comments: params.get('comments') || '',
    };
}

function htmlResponse(statusCode, html) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
        },
        body: html,
    };
}

exports.handler = async function (event) {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed',
        };
    }

    const form = parseBody(event);
    const name = String(form.name || '').trim();
    const email = String(form.email || '').trim();
    const subject = String(form.subject || '').trim();
    const comments = String(form.comments || '').trim();

    if (!name) {
        return htmlResponse(400, '<div class="error_message">You must enter your name.</div>');
    }

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return htmlResponse(400, '<div class="error_message">Please enter a valid email address.</div>');
    }

    if (!subject) {
        return htmlResponse(400, '<div class="error_message">Please enter your subject.</div>');
    }

    if (!comments) {
        return htmlResponse(400, '<div class="error_message">Please enter your message.</div>');
    }

    const config = getConfig();

    if (!config.user || !config.pass || !config.toEmail || !config.fromEmail) {
        return htmlResponse(500, '<div class="error_message">Contact email is not configured. Please set Netlify environment variables.</div>');
    }

    const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.pass,
        },
    });

    const mailSubject = config.subjectPrefix + ': ' + subject;
    const mailBody = [
        'You received a new message from your website contact form.',
        '',
        'Name: ' + name,
        'Email: ' + email,
        'Subject: ' + subject,
        '',
        'Message:',
        comments,
        ''
    ].join('\n');

    try {
        await transporter.sendMail({
            from: '"' + config.fromName + '" <' + config.fromEmail + '>',
            to: config.toEmail,
            replyTo: '"' + name + '" <' + email + '>',
            subject: mailSubject,
            text: mailBody,
        });

        return htmlResponse(200, "<fieldset><div id='success_page'><h3>Email Sent Successfully.</h3><p>Thank you <strong>" + escapeHtml(name) + "</strong>, your message has been submitted.</p></div></fieldset>");
    } catch (error) {
        console.error('Contact SMTP error:', error.message);
        if (config.debug) {
            return htmlResponse(500, '<div class="error_message">SMTP debug: ' + escapeHtml(error.message) + '</div>');
        }
        return htmlResponse(500, '<div class="error_message">Unable to send email at the moment. Please try again later.</div>');
    }
};
