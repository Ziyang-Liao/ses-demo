#!/usr/bin/env python3
"""
Generate the technical architecture diagram with official AWS icons.

Reproducible:
    python3 -m pip install --user diagrams      # requires graphviz `dot` on PATH
    python3 docs/architecture_diagram.py        # writes docs/images/architecture.png
"""
from diagrams import Cluster, Diagram, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb
from diagrams.aws.engagement import SimpleEmailServiceSes
from diagrams.aws.management import Cloudwatch
from diagrams.aws.network import APIGateway, CloudFront
from diagrams.aws.security import SecretsManager
from diagrams.generic.device import Mobile
from diagrams.onprem.client import User

GRAPH_ATTR = {
    "fontsize": "18",
    "fontname": "Helvetica",
    "labelloc": "t",
    "pad": "0.6",
    "ranksep": "1.0",
    "nodesep": "0.7",
    "bgcolor": "white",
}

with Diagram(
    "Email OTP Service — AWS Architecture",
    filename="docs/images/architecture",
    outformat="png",
    show=False,
    direction="LR",
    graph_attr=GRAPH_ATTR,
):
    user = Mobile("User\n(browser)")
    mailbox = User("Recipient\nmailbox")

    cdn = CloudFront("CloudFront\n(single origin)")

    with Cluster("API Gateway — HTTP API (throttled)"):
        api = APIGateway("/  ·  /v1/otp/*")

    with Cluster("AWS Lambda (Node 20, ARM64)"):
        web_fn = Lambda("Web\nGET /")
        request_fn = Lambda("RequestOtp\nPOST /request")
        verify_fn = Lambda("VerifyOtp\nPOST /verify")

    table = Dynamodb("DynamoDB\notp-codes (TTL)")
    secret = SecretsManager("Secrets Manager\nHMAC pepper")
    ses = SimpleEmailServiceSes("Amazon SES v2")
    logs = Cloudwatch("CloudWatch\nLogs · X-Ray")

    # Edge styles
    blue = Edge(color="#0b5fff")
    grey = Edge(color="#888888", style="dashed")

    # Request path
    user >> blue >> cdn >> blue >> api
    api >> blue >> web_fn
    api >> blue >> request_fn
    api >> blue >> verify_fn

    # RequestOtp dependencies
    request_fn >> Edge(color="#0a7d33", label="store hash") >> table
    request_fn >> Edge(color="#8a2be2", label="read pepper") >> secret
    request_fn >> Edge(color="#c0331f", label="SendEmail") >> ses
    ses >> Edge(color="#c0331f", label="deliver code") >> mailbox

    # VerifyOtp dependencies
    verify_fn >> Edge(color="#0a7d33", label="verify / consume") >> table
    verify_fn >> Edge(color="#8a2be2", label="read pepper") >> secret

    # Observability (dashed)
    web_fn >> grey >> logs
    request_fn >> grey >> logs
    verify_fn >> grey >> logs
