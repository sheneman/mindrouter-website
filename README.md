# MindRouter Website

Static promotional website for [MindRouter](https://github.com/ui-insight/MindRouter), an open-source LLM inference load balancer.

**Live at:** [mindrouter.ai](https://mindrouter.ai)

## Local Development

Open `index.html` in a browser, or serve with any static server:

```bash
python -m http.server 8080
# Visit http://localhost:8080
```

## Deployment

Hosted via GitHub Pages with a custom domain (`mindrouter.ai`). The `CNAME` file configures the domain.

## Configuration

- **Contact form**: Replace `YOUR_FORM_ID` in `index.html` with your Formspree form ID
- **reCAPTCHA**: Register `mindrouter.ai` at [Google reCAPTCHA admin](https://www.google.com/recaptcha/admin) and replace `YOUR_RECAPTCHA_SITE_KEY`

## License

Apache 2.0
