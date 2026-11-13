"""Generate an in-memory specimen report from a server-computed result."""
from datetime import datetime, timezone
from io import BytesIO


def prediction_pdf(sample, result):
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.pagesizes import A4
    output = BytesIO()
    styles = getSampleStyleSheet()
    story = [Paragraph('CellScope | Specimen analysis report', styles['Title']),
             Paragraph(datetime.now(timezone.utc).strftime('Generated %d %b %Y, %H:%M UTC'), styles['Normal']), Spacer(1, 18)]
    label = 'Likely malignant - clinical review needed' if result.prediction == 'malignant' else 'Likely benign - clinical confirmation needed'
    story += [Paragraph(label, styles['Heading2']),
              Paragraph(f'Model-estimated malignancy probability: {result.probability:.1%}<br/>Classification threshold: {result.threshold:.1%}', styles['Normal']),
              Spacer(1, 12), Paragraph('Scope and interpretation', styles['Heading2']),
              Paragraph('This is a model estimate for a measured breast mass, not a diagnosis or an estimate of future cancer risk. A benign result does not rule out cancer. Review the result with a qualified clinician alongside pathology and imaging.', styles['Normal']),
              Paragraph('Other health parameters', styles['Heading2']),
              Paragraph('Blood pressure, blood glucose, cholesterol, blood counts and other health risks are not measured or estimated by this model. No rates or normal ranges for these parameters can be inferred from the supplied cell measurements. A clinician can determine which additional tests are appropriate.', styles['Normal']),
              Spacer(1, 12), Paragraph('Submitted specimen measurements', styles['Heading2'])]
    data = [['Measurement', 'Value']] + [[key.replace('_', ' '), f'{value:.6g}'] for key, value in sample.features.items()]
    table = Table(data, colWidths=[350, 120], repeatRows=1)
    table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#183c46')), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f0f5f6')]), ('FONTSIZE', (0, 0), (-1, -1), 9), ('BOTTOMPADDING', (0, 0), (-1, -1), 7)]))
    story.append(table)
    def footer(canvas, doc):
        canvas.setFont('Helvetica', 8)
        canvas.drawString(40, 25, 'Educational model report | Not a clinical diagnosis')
        canvas.drawRightString(A4[0] - 40, 25, f'Page {doc.page}')
    SimpleDocTemplate(output, pagesize=A4, rightMargin=40, leftMargin=40, topMargin=40, bottomMargin=45).build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()
