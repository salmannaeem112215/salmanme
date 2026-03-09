<?php

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
	http_response_code(405);
	exit;
}

if (!defined('PHP_EOL')) {
	define('PHP_EOL', "\r\n");
}

/**
 * Minimal .env reader without external dependencies.
 */
function loadEnv($filePath)
{
	if (!is_file($filePath) || !is_readable($filePath)) {
		return;
	}

	$lines = file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
	if ($lines === false) {
		return;
	}

	foreach ($lines as $line) {
		$line = trim($line);

		if ($line === '' || strpos($line, '#') === 0) {
			continue;
		}

		if (strpos($line, '=') === false) {
			continue;
		}

		list($key, $value) = explode('=', $line, 2);
		$key = trim($key);
		$value = trim($value);

		if ($key === '') {
			continue;
		}

		if (
			strlen($value) >= 2 &&
			(($value[0] === '"' && substr($value, -1) === '"') || ($value[0] === "'" && substr($value, -1) === "'"))
		) {
			$value = substr($value, 1, -1);
		}

		if (getenv($key) === false) {
			putenv($key . '=' . $value);
		}

		if (!array_key_exists($key, $_ENV)) {
			$_ENV[$key] = $value;
		}
	}
}

function envValue($key, $default = '')
{
	$value = getenv($key);
	if ($value === false && array_key_exists($key, $_ENV)) {
		$value = $_ENV[$key];
	}

	return $value === false || $value === '' ? $default : $value;
}

function isEmail($email)
{
	return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}

function sanitizeHeaderValue($value)
{
	return trim(str_replace(array("\r", "\n"), '', (string) $value));
}

function smtpRead($socket)
{
	$data = '';
	while (($line = fgets($socket, 515)) !== false) {
		$data .= $line;
		if (strlen($line) >= 4 && $line[3] === ' ') {
			break;
		}
	}

	return $data;
}

function smtpWriteExpect($socket, $command, $expectedCode)
{
	if ($command !== null) {
		fwrite($socket, $command . "\r\n");
	}

	$response = smtpRead($socket);
	if (substr($response, 0, 3) !== (string) $expectedCode) {
		throw new Exception('SMTP error. Expected ' . $expectedCode . ', got: ' . trim($response));
	}
}

function smtpSendMessage($config, $fromEmail, $fromName, $toEmail, $replyEmail, $replyName, $subject, $body)
{
	$host = $config['host'];
	$port = (int) $config['port'];
	$encryption = strtolower($config['encryption']);
	$username = $config['username'];
	$password = $config['password'];
	$timeout = (int) $config['timeout'];

	$transportHost = $host;
	$useStartTls = false;

	if ($encryption === 'ssl') {
		$transportHost = 'ssl://' . $host;
	} elseif ($encryption === 'tls') {
		$useStartTls = true;
	}

	$socket = @fsockopen($transportHost, $port, $errno, $errstr, $timeout);
	if (!$socket) {
		throw new Exception('SMTP connection failed: ' . $errstr . ' (' . $errno . ')');
	}

	stream_set_timeout($socket, $timeout);

	try {
		smtpWriteExpect($socket, null, 220);
		smtpWriteExpect($socket, 'EHLO localhost', 250);

		if ($useStartTls) {
			smtpWriteExpect($socket, 'STARTTLS', 220);
			if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
				throw new Exception('Unable to start TLS encryption.');
			}
			smtpWriteExpect($socket, 'EHLO localhost', 250);
		}

		smtpWriteExpect($socket, 'AUTH LOGIN', 334);
		smtpWriteExpect($socket, base64_encode($username), 334);
		smtpWriteExpect($socket, base64_encode($password), 235);

		smtpWriteExpect($socket, 'MAIL FROM:<' . $fromEmail . '>', 250);
		smtpWriteExpect($socket, 'RCPT TO:<' . $toEmail . '>', 250);
		smtpWriteExpect($socket, 'DATA', 354);

		$headers = array(
			'Date: ' . date('r'),
			'From: ' . $fromName . ' <' . $fromEmail . '>',
			'To: <' . $toEmail . '>',
			'Reply-To: ' . $replyName . ' <' . $replyEmail . '>',
			'Subject: ' . $subject,
			'MIME-Version: 1.0',
			'Content-Type: text/plain; charset=UTF-8',
			'Content-Transfer-Encoding: 8bit',
		);

		$data = implode("\r\n", $headers) . "\r\n\r\n" . str_replace("\n.", "\n..", $body) . "\r\n.";
		smtpWriteExpect($socket, $data, 250);
		smtpWriteExpect($socket, 'QUIT', 221);
	} finally {
		fclose($socket);
	}
}

// src/assets/php/contact.php -> project root is ../../../
loadEnv(dirname(__DIR__, 3) . DIRECTORY_SEPARATOR . '.env');

$name = trim((string) ($_POST['name'] ?? ''));
$email = trim((string) ($_POST['email'] ?? ''));
$subject = trim((string) ($_POST['subject'] ?? ''));
$comments = trim((string) ($_POST['comments'] ?? ''));

if ($name === '') {
	echo '<div class="error_message">You must enter your name.</div>';
	exit;
}

if ($email === '' || !isEmail($email)) {
	echo '<div class="error_message">Please enter a valid email address.</div>';
	exit;
}

if ($subject === '') {
	echo '<div class="error_message">Please enter your subject.</div>';
	exit;
}

if ($comments === '') {
	echo '<div class="error_message">Please enter your message.</div>';
	exit;
}

$smtpHost = sanitizeHeaderValue(envValue('CONTACT_SMTP_HOST', envValue('SMTP_HOST', 'smtp.gmail.com')));
$smtpPort = sanitizeHeaderValue(envValue('CONTACT_SMTP_PORT', envValue('SMTP_PORT', '587')));
$smtpEncryption = sanitizeHeaderValue(envValue('CONTACT_SMTP_ENCRYPTION', envValue('SMTP_ENCRYPTION', 'tls')));
$smtpUser = sanitizeHeaderValue(envValue('CONTACT_SMTP_USER', envValue('EMAIL_USER', envValue('EMAIL_USERNAME', ''))));
$smtpPass = envValue('CONTACT_SMTP_APP_PASSWORD', envValue('EMAIL_APP_PASSWORD', envValue('SMTP_PASSWORD', '')));
$smtpDebug = filter_var(envValue('CONTACT_SMTP_DEBUG', 'false'), FILTER_VALIDATE_BOOLEAN);

$toEmail = sanitizeHeaderValue(envValue('CONTACT_TO_EMAIL', $smtpUser));
$fromEmail = sanitizeHeaderValue(envValue('CONTACT_FROM_EMAIL', $smtpUser));
$fromName = sanitizeHeaderValue(envValue('CONTACT_FROM_NAME', 'Website Contact Form'));
$subjectPrefix = sanitizeHeaderValue(envValue('CONTACT_SUBJECT_PREFIX', 'New Contact Message'));

if ($toEmail === '' || !isEmail($toEmail)) {
	http_response_code(500);
	echo '<div class="error_message">Server email is not configured. Please set CONTACT_TO_EMAIL in .env.</div>';
	exit;
}

if ($fromEmail === '' || !isEmail($fromEmail)) {
	http_response_code(500);
	echo '<div class="error_message">Server sender email is invalid. Please set CONTACT_FROM_EMAIL in .env.</div>';
	exit;
}

if ($smtpUser === '' || !isEmail($smtpUser)) {
	http_response_code(500);
	echo '<div class="error_message">SMTP username is missing/invalid. Please set CONTACT_SMTP_USER in .env.</div>';
	exit;
}

if ($smtpPass === '') {
	http_response_code(500);
	echo '<div class="error_message">SMTP app password is missing. Please set CONTACT_SMTP_APP_PASSWORD in .env.</div>';
	exit;
}

$safeName = sanitizeHeaderValue($name);
$safeEmail = sanitizeHeaderValue($email);
$safeSubject = sanitizeHeaderValue($subject);

$mailSubject = $subjectPrefix . ': ' . $safeSubject;

$body =
	'You received a new message from your website contact form.' . PHP_EOL . PHP_EOL .
	'Name: ' . $safeName . PHP_EOL .
	'Email: ' . $safeEmail . PHP_EOL .
	'Subject: ' . $safeSubject . PHP_EOL . PHP_EOL .
	'Message:' . PHP_EOL .
	$comments . PHP_EOL;

$message = wordwrap($body, 70);

try {
	smtpSendMessage(
		array(
			'host' => $smtpHost,
			'port' => $smtpPort,
			'encryption' => $smtpEncryption,
			'username' => $smtpUser,
			'password' => $smtpPass,
			'timeout' => (int) envValue('CONTACT_SMTP_TIMEOUT', '20'),
		),
		$fromEmail,
		$fromName,
		$toEmail,
		$safeEmail,
		$safeName,
		$mailSubject,
		$message
	);
	$sent = true;
} catch (Exception $e) {
	error_log('Contact form SMTP error: ' . $e->getMessage());
	if ($smtpDebug) {
		http_response_code(500);
		echo '<div class="error_message">SMTP debug: ' . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8') . '</div>';
		exit;
	}
	$sent = false;
}

if ($sent) {
	echo "<fieldset>";
	echo "<div id='success_page'>";
	echo "<h3>Email Sent Successfully.</h3>";
	echo "<p>Thank you <strong>" . htmlspecialchars($safeName, ENT_QUOTES, 'UTF-8') . "</strong>, your message has been submitted.</p>";
	echo "</div>";
	echo "</fieldset>";
} else {
	http_response_code(500);
	echo '<div class="error_message">Unable to send email at the moment. Please try again later.</div>';
}