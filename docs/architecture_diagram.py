#!/usr/bin/env python3
"""
Generate the technical architecture diagram using ONLY official AWS icons.

Reproducible:
    python3 -m pip install --user diagrams      # requires graphviz `dot` on PATH
    python3 docs/architecture_diagram.py        # writes docs/images/architecture.png

Every node — including the end user and the recipient mailbox — uses an icon from the
official AWS icon set shipped with the `diagrams` library (diagrams.aws.*).
"""
from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb
from diagrams.aws.engagement import SimpleEmailServiceSesEmail
from diagrams.aws.general import User
from diagrams.aws.management import Cloudwatch
from diagrams.aws.mobile import APIGateway
from diagrams.aws.network import CloudFront
from diagrams.aws.security import SecretsManager

GRAPH_ATTR = {
    "fontsize": "26",
    "fontname": "Helvetica-Bold",
    "labelloc": "t",
    "pad": "0.4",
    "ranksep": "1.6",   # horizontal gap between layers (LR) — keep edges readable
    "nodesep": "0.35",  # tighter vertical gap so icons sit close together
    "bgcolor": "white",
    "compound": "true",
    "splines": "spline",
}

# Big icons are the focus.
NODE_ATTR = {
    "fontsize": "15",
    "fontname": "Helvetica",
    "imagescale": "true",
    "width": "1.5",
    "height": "1.9",
    "fixedsize": "false",
}
EDGE_ATTR = {"fontsize": "13", "fontname": "Helvetica", "penwidth": "2.0"}

# AWS-style boundary framing.
AWS_CLOUD = {"bgcolor": "#F4F7FD", "pencolor": "#232F3E", "fontname": "Helvetica-Bold",
             "fontsize": "16", "penwidth": "2.0", "margin": "20"}
REGION = {"bgcolor": "#E9F2FC", "pencolor": "#147EBA", "style": "dashed",
          "fontname": "Helvetica-Bold", "fontsize": "15", "penwidth": "2.0", "margin": "18"}
GROUP = {"bgcolor": "#FFFFFF", "pencolor": "#FF9900", "fontname": "Helvetica-Bold",
         "fontsize": "13", "penwidth": "1.8", "margin": "14"}

with Diagram(
    "Email OTP Service — AWS Architecture",
    filename="docs/images/architecture",
    outformat="png",
    show=False,
    direction="LR",
    graph_attr=GRAPH_ATTR,
    node_attr=NODE_ATTR,
    edge_attr=EDGE_ATTR,
):
    user = User("End user\n(browser)")
    mailbox = User("Recipient\nmailbox")

    with Cluster("AWS Cloud", graph_attr=AWS_CLOUD):
        cdn = CloudFront("Amazon CloudFront\n(single origin)")

        with Cluster("Region: us-east-1", graph_attr=REGION):
            api = APIGateway("Amazon API Gateway\nHTTP API (throttled)")

            with Cluster("AWS Lambda (Node 20, ARM64)", graph_attr=GROUP):
                web_fn = Lambda("Web\nGET /")
                request_fn = Lambda("RequestOtp\nPOST /v1/otp/request")
                verify_fn = Lambda("VerifyOtp\nPOST /v1/otp/verify")

            table = Dynamodb("Amazon DynamoDB\notp-codes (TTL)")
            secret = SecretsManager("AWS Secrets Manager\nHMAC pepper")
            ses = SimpleEmailServiceSesEmail("Amazon SES v2")
            logs = Cloudwatch("Amazon CloudWatch\nLogs · AWS X-Ray")

    # Request/response path (blue)
    user >> Edge(color="#0b5fff") >> cdn >> Edge(color="#0b5fff") >> api
    api >> Edge(color="#0b5fff") >> web_fn
    api >> Edge(color="#0b5fff") >> request_fn
    api >> Edge(color="#0b5fff") >> verify_fn

    # RequestOtp dependencies
    request_fn >> Edge(color="#1a8f3c", label="store hash") >> table
    request_fn >> Edge(color="#8a2be2", label="read pepper") >> secret
    request_fn >> Edge(color="#c0331f", label="SendEmail") >> ses
    ses >> Edge(color="#c0331f", label="deliver code") >> mailbox

    # VerifyOtp dependencies
    verify_fn >> Edge(color="#1a8f3c", label="verify / consume") >> table
    verify_fn >> Edge(color="#8a2be2", label="read pepper") >> secret

    # Observability (dashed grey)
    web_fn >> Edge(color="#879196", style="dashed") >> logs
    request_fn >> Edge(color="#879196", style="dashed") >> logs
    verify_fn >> Edge(color="#879196", style="dashed") >> logs
