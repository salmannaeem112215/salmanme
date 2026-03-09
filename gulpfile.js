const browsersync = require('browser-sync').create();
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const cached = require('gulp-cached');
const cleanCSS = require('clean-css');
const cssnano = require('gulp-cssnano');
const del = require('del');
const fileinclude = require('gulp-file-include');
const gulp = require('gulp');
const gulpif = require('gulp-if');
const npmdist = require('gulp-npm-dist');
const replace = require('gulp-replace');
const uglify = require('gulp-uglify');
const useref = require('gulp-useref-plus');
const rename = require('gulp-rename');
const sass = require('gulp-sass')(require('sass'));
const sourcemaps = require("gulp-sourcemaps");
const postcss = require('gulp-postcss');
const autoprefixer = require("autoprefixer");
const tailwindcss = require('tailwindcss');

dotenv.config();

let contactTransporter = null;

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getContactMailerConfig() {
    return {
        host: process.env.CONTACT_SMTP_HOST || process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.CONTACT_SMTP_PORT || process.env.SMTP_PORT || 587),
        secure: (process.env.CONTACT_SMTP_ENCRYPTION || process.env.SMTP_ENCRYPTION || 'tls').toLowerCase() === 'ssl',
        user: process.env.CONTACT_SMTP_USER || process.env.EMAIL_USER || process.env.EMAIL_USERNAME || '',
        pass: process.env.CONTACT_SMTP_APP_PASSWORD || process.env.EMAIL_APP_PASSWORD || process.env.SMTP_PASSWORD || '',
        toEmail: process.env.CONTACT_TO_EMAIL || process.env.CONTACT_SMTP_USER || process.env.EMAIL_USER || '',
        fromEmail: process.env.CONTACT_FROM_EMAIL || process.env.CONTACT_SMTP_USER || process.env.EMAIL_USER || '',
        fromName: process.env.CONTACT_FROM_NAME || 'Website Contact Form',
        subjectPrefix: process.env.CONTACT_SUBJECT_PREFIX || 'New Contact Message',
        debug: String(process.env.CONTACT_SMTP_DEBUG || 'false').toLowerCase() === 'true',
    };
}

function getContactTransporter(config) {
    if (!contactTransporter) {
        contactTransporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: {
                user: config.user,
                pass: config.pass,
            },
        });
    }

    return contactTransporter;
}

async function handleContactPost(req, res) {
    const bodyBuffer = [];

    req.on('data', function (chunk) {
        bodyBuffer.push(chunk);
    });

    req.on('end', async function () {
        const formRaw = Buffer.concat(bodyBuffer).toString('utf8');
        const form = new URLSearchParams(formRaw);

        const name = (form.get('name') || '').trim();
        const email = (form.get('email') || '').trim();
        const subject = (form.get('subject') || '').trim();
        const comments = (form.get('comments') || '').trim();

        const config = getContactMailerConfig();

        if (!name) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<div class="error_message">You must enter your name.</div>');
            return;
        }

        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<div class="error_message">Please enter a valid email address.</div>');
            return;
        }

        if (!subject) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<div class="error_message">Please enter your subject.</div>');
            return;
        }

        if (!comments) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<div class="error_message">Please enter your message.</div>');
            return;
        }

        if (!config.user || !config.pass || !config.toEmail || !config.fromEmail) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<div class="error_message">Contact email is not configured. Please check your .env values.</div>');
            return;
        }

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
            const transporter = getContactTransporter(config);

            await transporter.sendMail({
                from: '"' + config.fromName + '" <' + config.fromEmail + '>',
                to: config.toEmail,
                replyTo: '"' + name + '" <' + email + '>',
                subject: mailSubject,
                text: mailBody,
            });

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end("<fieldset><div id='success_page'><h3>Email Sent Successfully.</h3><p>Thank you <strong>" + escapeHtml(name) + "</strong>, your message has been submitted.</p></div></fieldset>");
        } catch (error) {
            console.error('Contact SMTP error:', error.message);
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            if (config.debug) {
                res.end('<div class="error_message">SMTP debug: ' + escapeHtml(error.message) + '</div>');
                return;
            }
            res.end('<div class="error_message">Unable to send email at the moment. Please try again later.</div>');
        }
    });
}

const paths = {
    config: {
        tailwind: "./tailwind.config.js",
    },
    base: {
        base: {
            dir: './'
        },
        node: {
            dir: './node_modules'
        },
        packageLock: {
            files: './package-lock.json'
        }
    },
    dist: {
        base: {
            dir: './dist',
            files: './dist/**/*'
        },
        libs: {
            dir: './dist/assets/libs'
        },
        css: {
            dir: './dist/assets/css',
        },
        js: {
            dir: './dist/assets/js',
            files: './dist/assets/js/pages',
        },
    },
    src: {
        base: {
            dir: './src',
            files: './src/**/*'
        },
        css: {
            dir: './src/assets/css',
            files: './src/assets/css/**/*'
        },
        html: {
            dir: './src',
            files: './src/**/*.html',
        },
        img: {
            dir: './src/assets/images',
            files: './src/assets/images/**/*',
        },
        js: {
            dir: './src/assets/js',
            pages: './src/assets/js/pages',
            files: './src/assets/js/pages/*.js',
            main: './src/assets/js/*.js',
        },
        partials: {
            dir: './src/partials',
            files: './src/partials/**/*'
        },
        scss: {
            dir: './src/assets/scss',
            files: './src/assets/scss/**/*',
            main: './src/assets/scss/*.scss',
            icon: './src/assets/scss/icons.scss'
        }
    }
};

gulp.task('browsersync', function (callback) {
    browsersync.init({
        server: {
            baseDir: [paths.dist.base.dir, paths.src.base.dir, paths.base.base.dir],
            middleware: [
                function (req, res, next) {
                    const originalUrl = req.url || '/';
                    const [pathname, queryString] = originalUrl.split('?');

                    if (req.method === 'POST' && (pathname === '/assets/php/contact.php' || pathname === '/php/contact.php')) {
                        handleContactPost(req, res);
                        return;
                    }

                    const projectDetailMatch = pathname.match(/^\/project-details\/([^/]+)\/?$/);
                    if (projectDetailMatch) {
                        const projectSlug = decodeURIComponent(projectDetailMatch[1]);
                        const mergedQuery = queryString ? `${queryString}&slug=${encodeURIComponent(projectSlug)}` : `slug=${encodeURIComponent(projectSlug)}`;
                        req.url = `/project-details.html?${mergedQuery}`;
                        return next();
                    }

                    // Keep root, file requests, and asset routes unchanged.
                    if (!pathname || pathname === '/' || pathname.includes('.') || pathname.startsWith('/assets/') || pathname.startsWith('/node_modules/')) {
                        return next();
                    }

                    const normalizedPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
                    const relativePath = normalizedPath.replace(/^\/+/, '');
                    const htmlPath = `${relativePath}.html`;

                    const candidateFiles = [
                        path.join(paths.dist.base.dir, htmlPath),
                        path.join(paths.src.base.dir, htmlPath),
                    ];

                    const hasMatchingHtml = candidateFiles.some(file => fs.existsSync(file));

                    if (hasMatchingHtml) {
                        req.url = queryString ? `/${htmlPath}?${queryString}` : `/${htmlPath}`;
                    }

                    return next();
                }
            ]
        },
    });
    callback();
});

gulp.task('browsersyncReload', function (callback) {
    browsersync.reload();
    callback();
});

gulp.task('watch', function () {
    gulp.watch([paths.src.scss.files, '!' + paths.src.scss.icon], gulp.series('scss', 'browsersyncReload'));
    gulp.watch(paths.src.scss.icon, gulp.series('icons', 'browsersyncReload'));
    gulp.watch([paths.src.js.dir], gulp.series('js', 'browsersyncReload'));
    gulp.watch([paths.src.js.pages], gulp.series('jsPages', 'browsersyncReload'));
    gulp.watch([paths.src.html.files, paths.src.partials.files], gulp.series(['fileinclude', 'scss'], 'browsersyncReload'));
});

gulp.task('js', function () {
    return gulp
        .src(paths.src.js.main)
        // .pipe(uglify())
        .pipe(gulp.dest(paths.dist.js.dir));
});

gulp.task('jsPages', function () {
    return gulp
        .src(paths.src.js.files)
        // .pipe(uglify())
        .pipe(gulp.dest(paths.dist.js.files));
});

const cssOptions = {
    compatibility: "*", // (default) - Internet Explorer 10+ compatibility mode
    inline: ["all"], // enables all inlining, same as ['local', 'remote']
    level: 2, // Optimization levels. The level option can be either 0, 1 (default), or 2, e.g.
};


gulp.task('scss', function () {
    // generate tailwind  
    return gulp
        .src([paths.src.scss.main, '!' + paths.src.scss.icon])
        .pipe(sourcemaps.init())
        .pipe(sass().on('error', sass.logError))

        .pipe(postcss([
            tailwindcss(paths.config.tailwind),
            autoprefixer()
        ]))
        .pipe(gulp.dest(paths.dist.css.dir))
        // .pipe(cssnano({ svgo: false }))
        .on("data", function (file) {
            const buferFile = new cleanCSS(cssOptions).minify(file.contents);
            return (file.contents = Buffer.from(buferFile.styles));
        })
        .pipe(
            rename({
                suffix: ".min"
            })
        )
        .pipe(sourcemaps.write("./"))
        .pipe(gulp.dest(paths.dist.css.dir));
});


gulp.task('icons', function () {
    return gulp
        .src(paths.src.scss.icon, {allowEmpty: true})
        .pipe(sass().on('error', sass.logError))
        .pipe(gulp.dest(paths.dist.css.dir))
        .on("data", function (file) {
            const buferFile = new cleanCSS(cssOptions).minify(file.contents);
            return (file.contents = Buffer.from(buferFile.styles));
        })
        .pipe(
            rename({
                suffix: ".min"
            })
        )
        .pipe(gulp.dest(paths.dist.css.dir));
});

gulp.task('fileinclude', function () {
    return gulp
        .src([
            paths.src.html.files,
            '!' + paths.dist.base.files,
            '!' + paths.src.partials.files
        ])
        .pipe(fileinclude({
            prefix: '@@',
            basepath: '@file',
            indent: true,
        }))
        .pipe(cached())
        .pipe(gulp.dest(paths.dist.base.dir));
});

gulp.task('clean:packageLock', function (callback) {
    del.sync(paths.base.packageLock.files);
    callback();
});

gulp.task('clean:dist', function (callback) {
    del.sync(paths.dist.base.dir);
    callback();
});

gulp.task('copy:all', function () {
    return gulp
        .src([
            paths.src.base.files,
            '!' + paths.src.partials.dir, '!' + paths.src.partials.files,
            '!' + paths.src.scss.dir, '!' + paths.src.scss.files,
            '!' + paths.src.js.dir, '!' + paths.src.js.files, '!' + paths.src.js.main,
            '!' + paths.src.html.files,
        ])
        .pipe(gulp.dest(paths.dist.base.dir));
});

gulp.task('copy:libs', function () {
    return gulp
        .src(npmdist(), { base: paths.base.node.dir })
        .pipe(rename(function (path) {
            path.dirname = path.dirname.replace(/\/dist/, '').replace(/\\dist/, '');
        }))
        .pipe(gulp.dest(paths.dist.libs.dir));
});

gulp.task('html', function () {
    return gulp
        .src([
            paths.src.html.files,
            '!' + paths.dist.base.files,
            '!' + paths.src.partials.files
        ])
        .pipe(fileinclude({
            prefix: '@@',
            basepath: '@file',
            indent: true,
        }))
        .pipe(replace(/href="(.{0,10})node_modules/g, 'href="$1assets/libs'))
        .pipe(replace(/src="(.{0,10})node_modules/g, 'src="$1assets/libs'))
        .pipe(useref())
        .pipe(cached())
        .pipe(gulpif('*.js', uglify()))
        .pipe(gulpif('*.css', cssnano({ svgo: false })))
        .pipe(gulp.dest(paths.dist.base.dir));
});

// Default(Producation) Task
gulp.task('default', gulp.series(gulp.parallel('clean:packageLock', 'clean:dist', 'copy:all', 'copy:libs', 'fileinclude', 'scss', 'icons', 'js', 'jsPages', 'html'), gulp.parallel('browsersync', 'watch')));

// Build(Development) Task
gulp.task('build', gulp.series('clean:packageLock', 'clean:dist', 'copy:all', 'copy:libs', 'fileinclude', 'scss', 'icons', 'js', 'jsPages', 'html'));