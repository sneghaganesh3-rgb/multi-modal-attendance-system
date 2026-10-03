import csv
import io
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from datetime import datetime

def generate_csv(records: list, filename: str) -> bytes:
    output = io.StringIO()
    if not records:
        return output.getvalue().encode('utf-8')
    
    writer = csv.writer(output)
    # Headers
    headers = list(records[0].keys())
    writer.writerow(headers)
    
    # Data
    for record in records:
        writer.writerow([record.get(h, "") for h in headers])
        
    return output.getvalue().encode('utf-8')

def generate_pdf(records: list, title: str, filename: str) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    elements = []
    styles = getSampleStyleSheet()
    
    # Title
    elements.append(Paragraph(title, styles['Title']))
    elements.append(Spacer(1, 12))
    
    # Date
    elements.append(Paragraph(f"Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", styles['Normal']))
    elements.append(Spacer(1, 12))
    
    if not records:
        elements.append(Paragraph("No records found.", styles['Normal']))
        doc.build(elements)
        return buffer.getvalue()
    
    # Table data
    headers = list(records[0].keys())
    data = [headers]
    for record in records:
        data.append([str(record.get(h, "")) for h in headers])
        
    table = Table(data)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
        ('GRID', (0, 0), (-1, -1), 1, colors.black)
    ]))
    
    elements.append(table)
    doc.build(elements)
    
    return buffer.getvalue()
